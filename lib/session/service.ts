import type {
  Clock,
  CredentialGenerator,
  CsrfTokenGenerator,
  IdGenerator,
  SessionManager,
  SessionRepository,
} from "./interfaces.ts";
import {
  type Session,
  session_expiry,
  type SessionAuthenticationAttemptConsumeResult,
  type SessionAuthenticationAttemptInput,
  type SessionAuthenticationAttemptSaveResult,
  type SessionCredential,
  type SessionLogoutResult,
  type SessionRecord,
  type SessionResolution,
  type SessionUpgradeResult,
} from "./model.ts";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_ATTEMPT_CONTEXT_LENGTH = 4096;
const MAX_GENERATION_ATTEMPTS = 8;

export interface SessionConfig {
  readonly guest_absolute_lifetime_ms: number;
  readonly authenticated_idle_lifetime_ms: number;
  readonly authenticated_absolute_lifetime_ms: number;
  readonly renewal_threshold_ms: number;
  readonly authentication_attempt_lifetime_ms: number;
  readonly max_pending_authentication_attempts: number;
}

export const default_session_config: SessionConfig = {
  guest_absolute_lifetime_ms: 7 * DAY_MS,
  authenticated_idle_lifetime_ms: 30 * DAY_MS,
  authenticated_absolute_lifetime_ms: 90 * DAY_MS,
  renewal_threshold_ms: DAY_MS,
  authentication_attempt_lifetime_ms: 10 * MINUTE_MS,
  max_pending_authentication_attempts: 5,
};

export interface SessionServiceOptions {
  readonly repository: SessionRepository;
  readonly clock: Clock;
  readonly id_generator: IdGenerator;
  readonly credential_generator: CredentialGenerator;
  readonly csrf_token_generator: CsrfTokenGenerator;
  readonly config?: SessionConfig;
}

/** Owns session lifecycle; HTTP cookie behavior remains a transport concern. */
export class SessionService implements SessionManager {
  readonly #repository: SessionRepository;
  readonly #clock: Clock;
  readonly #id_generator: IdGenerator;
  readonly #credential_generator: CredentialGenerator;
  readonly #csrf_token_generator: CsrfTokenGenerator;
  readonly #config: SessionConfig;

  constructor(options: SessionServiceOptions) {
    this.#repository = options.repository;
    this.#clock = options.clock;
    this.#id_generator = options.id_generator;
    this.#credential_generator = options.credential_generator;
    this.#csrf_token_generator = options.csrf_token_generator;
    this.#config = options.config ?? default_session_config;
    validate_config(this.#config);
  }

  /** Invalid, unknown, expired, and revoked credentials all fail closed. */
  async resolve(credential?: string | null): Promise<SessionResolution> {
    if (
      credential === undefined || credential === null ||
      !CREDENTIAL_PATTERN.test(credential)
    ) {
      return await this.#create_guest();
    }

    const credential_hash = await hash_session_credential(credential);
    const record = await this.#repository.find_by_credential_hash(
      credential_hash,
    );
    const now = this.#clock.now();
    if (record === null) return await this.#create_guest(now);
    if (is_unusable(record, now)) {
      await this.#repository.revoke(
        record.session_id,
        record.session_version,
        now,
      );
      return await this.#create_guest(now);
    }

    if (
      now.getTime() - record.last_seen_at.getTime() >=
        this.#config.renewal_threshold_ms
    ) {
      const idle_expires_at = record.kind === "authenticated"
        ? min_date(
          add_ms(now, this.#config.authenticated_idle_lifetime_ms),
          record.absolute_expires_at,
        )
        : undefined;
      const renewed = await this.#repository.renew(
        record.session_id,
        record.session_version,
        now,
        idle_expires_at,
      );
      if (renewed === null) return await this.#create_guest(now);
      const session = public_session(renewed);
      return {
        session,
        credential_to_set: credential_update(credential, session),
      };
    }

    return { session: public_session(record) };
  }

  /** Store only a state hash and bounded provider context on a guest session. */
  async save_authentication_attempt(
    session: Session,
    input: SessionAuthenticationAttemptInput,
  ): Promise<SessionAuthenticationAttemptSaveResult> {
    if (session.kind !== "guest") {
      return { ok: false, reason: "not_guest" };
    }
    validate_authentication_attempt(input);
    const created_at = this.#clock.now();
    if (session_expiry(session) <= created_at) {
      await this.#repository.revoke(
        session.session_id,
        session.session_version,
        created_at,
      );
      return { ok: false, reason: "stale_session" };
    }

    return await this.#repository.save_authentication_attempt({
      session_id: session.session_id,
      expected_version: session.session_version,
      attempt: {
        strategy_id: input.strategy_id,
        state_hash: await hash_authentication_state(input.state),
        callback_url: input.callback_url,
        return_to: input.return_to,
        attempt_context: input.attempt_context,
        created_at,
        expires_at: add_ms(
          created_at,
          this.#config.authentication_attempt_lifetime_ms,
        ),
      },
      max_pending_attempts: this.#config.max_pending_authentication_attempts,
    });
  }

  /** Consume before provider exchange so failures and replays cannot retry it. */
  async consume_authentication_attempt(
    session: Session,
    strategy_id: string,
    state: string,
  ): Promise<SessionAuthenticationAttemptConsumeResult> {
    if (session.kind !== "guest") {
      return { ok: false, reason: "not_guest" };
    }
    if (!CREDENTIAL_PATTERN.test(state)) {
      return { ok: false, reason: "invalid_attempt" };
    }
    const consumed_at = this.#clock.now();
    if (session_expiry(session) <= consumed_at) {
      await this.#repository.revoke(
        session.session_id,
        session.session_version,
        consumed_at,
      );
      return { ok: false, reason: "stale_session" };
    }

    const result = await this.#repository.consume_authentication_attempt({
      session_id: session.session_id,
      expected_version: session.session_version,
      strategy_id,
      state_hash: await hash_authentication_state(state),
      consumed_at,
    });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason === "not_found"
          ? "invalid_attempt"
          : result.reason,
      };
    }
    return { ok: true, attempt: result.attempt };
  }

  /**
   * Upgrade a logical session while atomically replacing its bearer
   * credential. A stale concurrent request cannot rotate the new session.
   */
  async upgrade(
    session: Session,
    user_id: string,
  ): Promise<SessionUpgradeResult> {
    if (user_id.length === 0) throw new TypeError("user_id must not be empty");
    const authenticated_at = this.#clock.now();
    if (session_expiry(session) <= authenticated_at) {
      await this.#repository.revoke(
        session.session_id,
        session.session_version,
        authenticated_at,
      );
      return { ok: false, reason: "stale_session" };
    }
    const absolute_expires_at = add_ms(
      authenticated_at,
      this.#config.authenticated_absolute_lifetime_ms,
    );
    const idle_expires_at = min_date(
      add_ms(authenticated_at, this.#config.authenticated_idle_lifetime_ms),
      absolute_expires_at,
    );

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      const credential = this.#generate_credential();
      const result = await this.#repository.upgrade({
        session_id: session.session_id,
        expected_version: session.session_version,
        credential_hash: await hash_session_credential(credential),
        csrf_token: this.#generate_csrf_token(),
        user_id,
        authenticated_at,
        absolute_expires_at,
        idle_expires_at,
      });
      if (result.ok) {
        const upgraded = public_session(result.record);
        return {
          ok: true,
          resolution: {
            session: upgraded,
            credential_to_set: credential_update(credential, upgraded),
          },
        };
      }
      if (result.reason === "stale_session") {
        return { ok: false, reason: "stale_session" };
      }
    }
    throw new Error("could not allocate a unique session credential");
  }

  revoke(session: Session): Promise<boolean> {
    return this.#repository.revoke(
      session.session_id,
      session.session_version,
      this.#clock.now(),
    );
  }

  /** Revoke authenticated access before issuing an unrelated guest bearer. */
  async logout(
    session: Session,
    csrf_token: string,
  ): Promise<SessionLogoutResult> {
    if (session.kind !== "authenticated") {
      return { ok: false, reason: "not_authenticated" };
    }
    if (!CREDENTIAL_PATTERN.test(csrf_token)) {
      return { ok: false, reason: "invalid_csrf" };
    }

    const logged_out_at = this.#clock.now();
    const result = await this.#repository.logout({
      session_id: session.session_id,
      expected_version: session.session_version,
      csrf_token,
      logged_out_at,
    });
    if (!result.ok) return result;
    return { ok: true, resolution: await this.#create_guest(logged_out_at) };
  }

  async #create_guest(at = this.#clock.now()): Promise<SessionResolution> {
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      const credential = this.#generate_credential();
      const session: Session = {
        kind: "guest",
        session_id: this.#id_generator.generate(),
        session_version: 1,
        created_at: new Date(at),
        last_seen_at: new Date(at),
        absolute_expires_at: add_ms(
          at,
          this.#config.guest_absolute_lifetime_ms,
        ),
      };
      const record: SessionRecord = {
        ...session,
        credential_hash: await hash_session_credential(credential),
        revoked_at: null,
        authentication_attempts: [],
      };
      if (await this.#repository.create(record)) {
        return {
          session,
          credential_to_set: credential_update(credential, session),
        };
      }
    }
    throw new Error("could not allocate a unique session");
  }

  #generate_credential(): string {
    const credential = this.#credential_generator.generate();
    if (!CREDENTIAL_PATTERN.test(credential)) {
      throw new Error("credential generator must return 256-bit base64url");
    }
    return credential;
  }

  #generate_csrf_token(): string {
    const csrf_token = this.#csrf_token_generator.generate();
    if (!CREDENTIAL_PATTERN.test(csrf_token)) {
      throw new Error("CSRF token generator must return 256-bit base64url");
    }
    return csrf_token;
  }
}

/** One-way lookup value; raw bearer credentials are never persisted. */
export function hash_session_credential(credential: string): Promise<string> {
  return hash_secret(credential);
}

/** One-way OAuth-state value; raw state is returned only to the provider. */
export function hash_authentication_state(state: string): Promise<string> {
  return hash_secret(state);
}

async function hash_secret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function is_unusable(record: SessionRecord, now: Date): boolean {
  return record.revoked_at !== null || session_expiry(record) <= now;
}

function credential_update(
  value: string,
  session: Session,
): SessionCredential {
  return { value, expires_at: new Date(session_expiry(session)) };
}

function public_session(record: SessionRecord): Session {
  const common = {
    session_id: record.session_id,
    session_version: record.session_version,
    created_at: new Date(record.created_at),
    last_seen_at: new Date(record.last_seen_at),
    absolute_expires_at: new Date(record.absolute_expires_at),
  };
  return record.kind === "guest" ? { kind: "guest", ...common } : {
    kind: "authenticated",
    ...common,
    user_id: record.user_id,
    authenticated_at: new Date(record.authenticated_at),
    idle_expires_at: new Date(record.idle_expires_at),
    csrf_token: record.csrf_token,
  };
}

function add_ms(date: Date, duration_ms: number): Date {
  return new Date(date.getTime() + duration_ms);
}

function min_date(left: Date, right: Date): Date {
  return left < right ? left : new Date(right);
}

function validate_authentication_attempt(
  input: SessionAuthenticationAttemptInput,
): void {
  if (!CREDENTIAL_PATTERN.test(input.state)) {
    throw new TypeError("authentication state must be 256-bit base64url");
  }
  if (input.strategy_id.length === 0 || input.strategy_id.length > 64) {
    throw new TypeError("strategy_id must contain 1 to 64 characters");
  }
  if (input.callback_url.length === 0 || input.callback_url.length > 2048) {
    throw new TypeError("callback_url must contain 1 to 2048 characters");
  }
  if (input.return_to.length === 0 || input.return_to.length > 2048) {
    throw new TypeError("return_to must contain 1 to 2048 characters");
  }
  if (
    input.attempt_context !== undefined &&
    input.attempt_context.length > MAX_ATTEMPT_CONTEXT_LENGTH
  ) {
    throw new TypeError("attempt_context must not exceed 4096 characters");
  }
}

function validate_config(config: SessionConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive integer`);
    }
  }
  if (
    config.renewal_threshold_ms >= config.guest_absolute_lifetime_ms ||
    config.renewal_threshold_ms >= config.authenticated_idle_lifetime_ms
  ) {
    throw new TypeError(
      "renewal threshold must be shorter than session lifetime",
    );
  }
}
