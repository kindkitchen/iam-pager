import { encode_base64url } from "../base64url.ts";
import type {
  Clock,
  CredentialGenerator,
  IdGenerator,
} from "../session/interfaces.ts";
import type { Session } from "../session/model.ts";
import type {
  StorageConnection,
  StorageConnectionCredentials,
} from "./connection-model.ts";
import type { StorageConnectionRepository } from "./connection-repository.ts";
import {
  google_drive_provider_id,
  type GoogleDriveOAuthClient,
} from "./google-drive-oauth.ts";
import type { StorageOAuthAttemptRepository } from "./storage-oauth-attempt-repository.ts";

const attempt_lifetime_ms = 10 * 60 * 1000;

export type GoogleDriveConnectionFailureReason =
  | "not_authenticated"
  | "invalid_attempt"
  | "provider_failure"
  | "provider_account_conflict"
  | "persistence_failure";

export type GoogleDriveConnectionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: GoogleDriveConnectionFailureReason };

export interface GoogleDriveConnectionManager {
  start(
    session: Session,
    callback_url: string,
  ): Promise<GoogleDriveConnectionResult<{ authorization_url: string }>>;
  complete(
    session: Session,
    state: string,
    code: string,
  ): Promise<GoogleDriveConnectionResult<{ connection: StorageConnection }>>;
  disconnect(
    session: Session,
  ): Promise<GoogleDriveConnectionResult<{ connection: StorageConnection }>>;
}

/** Session-bound orchestration for storage consent; it never establishes identity. */
export class GoogleDriveConnectionService
  implements GoogleDriveConnectionManager {
  readonly #oauth: GoogleDriveOAuthClient;
  readonly #connections: StorageConnectionRepository;
  readonly #attempts: StorageOAuthAttemptRepository;
  readonly #state_generator: CredentialGenerator;
  readonly #connection_id_generator: IdGenerator;
  readonly #clock: Clock;

  constructor(options: {
    oauth: GoogleDriveOAuthClient;
    connections: StorageConnectionRepository;
    attempts: StorageOAuthAttemptRepository;
    state_generator: CredentialGenerator;
    connection_id_generator: IdGenerator;
    clock: Clock;
  }) {
    this.#oauth = options.oauth;
    this.#connections = options.connections;
    this.#attempts = options.attempts;
    this.#state_generator = options.state_generator;
    this.#connection_id_generator = options.connection_id_generator;
    this.#clock = options.clock;
  }

  async start(
    session: Session,
    callback_url: string,
  ): Promise<GoogleDriveConnectionResult<{ authorization_url: string }>> {
    if (session.kind !== "authenticated") {
      return { ok: false, reason: "not_authenticated" };
    }
    const state = this.#state_generator.generate();
    const state_hash = await hash_state(state);
    const started = await this.#oauth.begin({ state, callback_url });
    if (!started.ok) return started;
    const created_at = this.#clock.now();
    try {
      const saved = await this.#attempts.save({
        state_hash,
        session_id: session.session_id,
        user_id: session.user_id,
        callback_url,
        attempt_context: started.value.attempt_context,
        created_at,
        expires_at: new Date(created_at.getTime() + attempt_lifetime_ms),
      });
      if (!saved) return { ok: false, reason: "persistence_failure" };
    } catch {
      return { ok: false, reason: "persistence_failure" };
    }
    return {
      ok: true,
      value: { authorization_url: started.value.authorization_url },
    };
  }

  async complete(
    session: Session,
    state: string,
    code: string,
  ): Promise<GoogleDriveConnectionResult<{ connection: StorageConnection }>> {
    if (session.kind !== "authenticated") {
      return { ok: false, reason: "not_authenticated" };
    }
    let attempt;
    try {
      attempt = await this.#attempts.consume(
        await hash_state(state),
        session.session_id,
        session.user_id,
        this.#clock.now(),
      );
    } catch {
      return { ok: false, reason: "persistence_failure" };
    }
    if (attempt === null) return { ok: false, reason: "invalid_attempt" };

    const completed = await this.#oauth.complete({
      code,
      callback_url: attempt.callback_url,
      attempt_context: attempt.attempt_context,
    });
    if (!completed.ok) return completed;

    try {
      return await this.#save_grant(
        session.user_id,
        completed.value.provider_subject,
        completed.value.scopes,
        completed.value.credentials,
      );
    } catch {
      return { ok: false, reason: "persistence_failure" };
    }
  }

  async disconnect(
    session: Session,
  ): Promise<GoogleDriveConnectionResult<{ connection: StorageConnection }>> {
    if (session.kind !== "authenticated") {
      return { ok: false, reason: "not_authenticated" };
    }
    try {
      const connection = await this.#connections.find_active_by_user_provider(
        session.user_id,
        google_drive_provider_id,
      );
      if (connection === null) {
        return { ok: false, reason: "invalid_attempt" };
      }
      const credentials = await this.#connections.get_credentials(
        connection.connection_id,
      );
      if (credentials !== null) {
        try {
          await this.#oauth.revoke(credentials);
        } catch {
          // Remote revocation is best effort; local token destruction is mandatory.
        }
      }
      const revoked = await this.#connections.revoke(
        connection.connection_id,
        session.user_id,
        this.#clock.now(),
      );
      return revoked === null
        ? { ok: false, reason: "persistence_failure" }
        : { ok: true, value: { connection: revoked } };
    } catch {
      return { ok: false, reason: "persistence_failure" };
    }
  }

  async #save_grant(
    user_id: string,
    provider_subject: string,
    scopes: readonly string[],
    credentials: StorageConnectionCredentials,
  ): Promise<GoogleDriveConnectionResult<{ connection: StorageConnection }>> {
    const now = this.#clock.now();
    const active = await this.#connections.find_active_by_user_provider(
      user_id,
      google_drive_provider_id,
    );
    if (active !== null) {
      if (active.provider_subject !== provider_subject) {
        return { ok: false, reason: "provider_account_conflict" };
      }
      return await this.#reauthorize(active, scopes, credentials, now);
    }

    const prior = (await this.#connections.list_by_user(user_id))
      .filter((connection) =>
        connection.provider_id === google_drive_provider_id &&
        connection.provider_subject === provider_subject
      )
      .sort((left, right) =>
        right.updated_at.getTime() - left.updated_at.getTime()
      )[0];
    if (prior !== undefined) {
      return await this.#reauthorize(prior, scopes, credentials, now);
    }

    const connection: StorageConnection = {
      connection_id: this.#connection_id_generator.generate(),
      user_id,
      provider_id: google_drive_provider_id,
      provider_subject,
      scopes: [...scopes],
      status: "active",
      created_at: now,
      updated_at: now,
    };
    const created = await this.#connections.create(connection);
    if (!created.ok) {
      if (created.reason === "active_connection_conflict") {
        return { ok: false, reason: "provider_account_conflict" };
      }
      return { ok: false, reason: "persistence_failure" };
    }
    if (
      !await this.#connections.put_credentials(
        created.connection.connection_id,
        credentials,
      )
    ) {
      await this.#connections.revoke(
        created.connection.connection_id,
        user_id,
        this.#clock.now(),
      );
      return { ok: false, reason: "persistence_failure" };
    }
    return { ok: true, value: { connection: created.connection } };
  }

  async #reauthorize(
    connection: StorageConnection,
    scopes: readonly string[],
    credentials: StorageConnectionCredentials,
    updated_at: Date,
  ): Promise<GoogleDriveConnectionResult<{ connection: StorageConnection }>> {
    const previous = await this.#connections.get_credentials(
      connection.connection_id,
    );
    const merged_credentials = credentials.refresh_token === undefined &&
        previous?.refresh_token !== undefined
      ? { ...credentials, refresh_token: previous.refresh_token }
      : credentials;
    const result = await this.#connections.reauthorize({
      connection_id: connection.connection_id,
      user_id: connection.user_id,
      provider_subject: connection.provider_subject,
      scopes,
      credentials: merged_credentials,
      updated_at,
    });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason === "provider_subject_mismatch" ||
            result.reason === "active_connection_conflict"
          ? "provider_account_conflict"
          : "persistence_failure",
      };
    }
    return { ok: true, value: { connection: result.connection } };
  }
}

async function hash_state(state: string): Promise<string> {
  return encode_base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state)),
    ),
  );
}
