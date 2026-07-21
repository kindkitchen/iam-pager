import { csrf_tokens_match } from "../http/csrf.ts";
import type { KvRecordGateway } from "../storage/kv-gateway.ts";
import { is_exact_record, is_valid_stored_date } from "../storage/record.ts";
import type {
  RepositoryAuthenticationAttemptConsume,
  RepositoryAuthenticationAttemptConsumeResult,
  RepositoryAuthenticationAttemptSave,
  RepositoryAuthenticationAttemptSaveResult,
  RepositoryLogout,
  RepositoryLogoutResult,
  RepositoryUpgradeResult,
  SessionRepository,
  SessionUpgrade,
} from "./interfaces.ts";
import type { SessionAuthenticationAttempt, SessionRecord } from "./model.ts";

const max_update_attempts = 16;
const record_prefix: Deno.KvKey = ["iam-pager", "sessions", "by-id"];
const credential_prefix: Deno.KvKey = [
  "iam-pager",
  "sessions",
  "by-credential",
];

type StoredSessionRecord = SessionRecord;

interface StoredCredentialIndex {
  readonly session_id: string;
}

function record_key(session_id: string): Deno.KvKey {
  return [...record_prefix, session_id];
}

function credential_key(credential_hash: string): Deno.KvKey {
  return [...credential_prefix, credential_hash];
}

function invalid_record(): never {
  throw new TypeError("invalid stored session record");
}

const common_record_fields = [
  "kind",
  "session_id",
  "session_version",
  "created_at",
  "last_seen_at",
  "absolute_expires_at",
  "credential_hash",
  "revoked_at",
  "authentication_attempts",
] as const;
const authenticated_record_fields = [
  ...common_record_fields,
  "user_id",
  "authenticated_at",
  "idle_expires_at",
  "csrf_token",
] as const;

function deserialize_attempt(value: unknown): SessionAuthenticationAttempt {
  if (
    !is_exact_record(value, [
      "strategy_id",
      "state_hash",
      "callback_url",
      "return_to",
      "created_at",
      "expires_at",
    ], ["attempt_context"])
  ) return invalid_record();
  const stored = value as unknown as SessionAuthenticationAttempt;
  if (
    typeof stored.strategy_id !== "string" || stored.strategy_id === "" ||
    typeof stored.state_hash !== "string" || stored.state_hash === "" ||
    typeof stored.callback_url !== "string" || stored.callback_url === "" ||
    typeof stored.return_to !== "string" || stored.return_to === "" ||
    (stored.attempt_context !== undefined &&
      typeof stored.attempt_context !== "string") ||
    !is_valid_stored_date(stored.created_at) ||
    !is_valid_stored_date(stored.expires_at) ||
    stored.expires_at < stored.created_at
  ) return invalid_record();
  return structuredClone(stored);
}

function deserialize_record(value: unknown): SessionRecord {
  const kind = typeof value === "object" && value !== null
    ? (value as { kind?: unknown }).kind
    : undefined;
  if (
    !is_exact_record(
      value,
      kind === "authenticated"
        ? authenticated_record_fields
        : common_record_fields,
    )
  ) return invalid_record();
  const stored = value as unknown as SessionRecord;
  if (
    (stored.kind !== "guest" && stored.kind !== "authenticated") ||
    typeof stored.session_id !== "string" || stored.session_id === "" ||
    !Number.isSafeInteger(stored.session_version) ||
    stored.session_version <= 0 ||
    typeof stored.credential_hash !== "string" ||
    stored.credential_hash === "" ||
    !is_valid_stored_date(stored.created_at) ||
    !is_valid_stored_date(stored.last_seen_at) ||
    !is_valid_stored_date(stored.absolute_expires_at) ||
    (stored.revoked_at !== null &&
      !is_valid_stored_date(stored.revoked_at)) ||
    !Array.isArray(stored.authentication_attempts) ||
    stored.last_seen_at < stored.created_at ||
    stored.absolute_expires_at < stored.created_at
  ) return invalid_record();
  stored.authentication_attempts.forEach(deserialize_attempt);
  if (
    stored.kind === "authenticated" && (
      typeof stored.user_id !== "string" || stored.user_id === "" ||
      typeof stored.csrf_token !== "string" || stored.csrf_token === "" ||
      !is_valid_stored_date(stored.authenticated_at) ||
      !is_valid_stored_date(stored.idle_expires_at) ||
      stored.authenticated_at < stored.created_at ||
      stored.idle_expires_at < stored.authenticated_at ||
      stored.absolute_expires_at < stored.authenticated_at
    )
  ) return invalid_record();
  return structuredClone(stored);
}

function serialize_credential_index(session_id: string): StoredCredentialIndex {
  return { session_id };
}

function deserialize_credential_index(value: unknown): StoredCredentialIndex {
  if (!is_exact_record(value, ["session_id"])) {
    throw new TypeError("invalid stored session credential index");
  }
  const stored = value;
  if (typeof stored.session_id !== "string" || stored.session_id.length === 0) {
    throw new TypeError("invalid stored session credential index");
  }
  return { session_id: stored.session_id };
}

function expiry_options(record: SessionRecord, reference_at: Date) {
  return {
    expireIn: Math.max(
      1,
      record.absolute_expires_at.getTime() - reference_at.getTime(),
    ),
  };
}

function later_date(left: Date, right: Date): Date {
  return left < right ? new Date(right) : new Date(left);
}

interface LoadedRecord {
  readonly entry: Deno.KvEntryMaybe<unknown>;
  readonly record: SessionRecord;
}

/**
 * Deno KV session persistence with atomic logical-version checks and bearer
 * rotation. Records and credential indexes share an absolute-lifetime TTL;
 * service-level expiry checks remain authoritative because KV expiry is lazy.
 */
export class DenoKvSessionRepository implements SessionRepository {
  readonly #kv: KvRecordGateway;

  constructor(kv: KvRecordGateway) {
    this.#kv = kv;
  }

  async find_by_credential_hash(
    credential_hash: string,
  ): Promise<SessionRecord | null> {
    const index_key = credential_key(credential_hash);
    for (let attempt = 0; attempt < max_update_attempts; attempt++) {
      const initial_index = await this.#kv.get<unknown>(index_key);
      if (initial_index.versionstamp === null) return null;
      const index = deserialize_credential_index(initial_index.value);
      const [stable_index, record_entry] = await this.#kv.get_many([
        index_key,
        record_key(index.session_id),
      ]);
      if (stable_index.versionstamp !== initial_index.versionstamp) continue;
      if (record_entry.versionstamp === null) {
        await this.#kv.native_atomic().check(stable_index).delete(index_key)
          .commit();
        return null;
      }
      const record = deserialize_record(record_entry.value);
      if (
        record.session_id !== index.session_id ||
        record.credential_hash !== credential_hash
      ) {
        throw new Error("session repository invariant violated");
      }
      return record;
    }
    throw new Error("session lookup remained contended");
  }

  create(record: SessionRecord): Promise<boolean> {
    return this.#create(deserialize_record(record));
  }

  async #create(stored: StoredSessionRecord): Promise<boolean> {
    const session_key = record_key(stored.session_id);
    const index_key = credential_key(stored.credential_hash);
    const [session_entry, index_entry] = await this.#kv.get_many([
      session_key,
      index_key,
    ]);
    if (
      session_entry.versionstamp !== null || index_entry.versionstamp !== null
    ) {
      return false;
    }
    const expires = expiry_options(stored, stored.created_at);
    const commit = await this.#kv.native_atomic()
      .check(session_entry)
      .check(index_entry)
      .set(session_key, stored, expires)
      .set(
        index_key,
        serialize_credential_index(stored.session_id),
        expires,
      )
      .commit();
    return commit.ok;
  }

  renew(
    session_id: string,
    expected_version: number,
    last_seen_at: Date,
    idle_expires_at?: Date,
  ): Promise<SessionRecord | null> {
    return this.#renew(
      session_id,
      expected_version,
      new Date(last_seen_at),
      idle_expires_at === undefined ? undefined : new Date(idle_expires_at),
    );
  }

  async #renew(
    session_id: string,
    expected_version: number,
    last_seen_at: Date,
    idle_expires_at?: Date,
  ): Promise<SessionRecord | null> {
    for (let attempt = 0; attempt < max_update_attempts; attempt++) {
      const loaded = await this.#load_record(session_id);
      if (
        loaded === null || loaded.record.revoked_at !== null ||
        loaded.record.session_version !== expected_version
      ) {
        return null;
      }
      const current = loaded.record;
      const next_last_seen = later_date(current.last_seen_at, last_seen_at);
      const updated: SessionRecord = current.kind === "guest"
        ? { ...current, last_seen_at: next_last_seen }
        : {
          ...current,
          last_seen_at: next_last_seen,
          idle_expires_at: idle_expires_at === undefined
            ? new Date(current.idle_expires_at)
            : later_date(current.idle_expires_at, idle_expires_at),
        };
      const commit = await this.#kv.native_atomic()
        .check(loaded.entry)
        .set(
          record_key(session_id),
          structuredClone(updated),
          expiry_options(updated, next_last_seen),
        )
        .commit();
      if (commit.ok) return structuredClone(updated);
    }
    throw new Error("session renewal remained contended");
  }

  save_authentication_attempt(
    input: RepositoryAuthenticationAttemptSave,
  ): Promise<RepositoryAuthenticationAttemptSaveResult> {
    return this.#save_authentication_attempt(structuredClone(input));
  }

  async #save_authentication_attempt(
    input: RepositoryAuthenticationAttemptSave,
  ): Promise<RepositoryAuthenticationAttemptSaveResult> {
    for (let update = 0; update < max_update_attempts; update++) {
      const loaded = await this.#load_record(input.session_id);
      if (
        loaded === null || loaded.record.revoked_at !== null ||
        loaded.record.session_version !== input.expected_version
      ) {
        return { ok: false, reason: "stale_session" };
      }
      const current = loaded.record;
      if (current.kind !== "guest") {
        return { ok: false, reason: "not_guest" };
      }
      const active_attempts = current.authentication_attempts.filter(
        (attempt) => attempt.expires_at > input.attempt.created_at,
      );
      if (
        active_attempts.some((attempt) =>
          attempt.state_hash === input.attempt.state_hash
        )
      ) {
        return { ok: false, reason: "state_collision" };
      }
      const retained_attempts = input.max_pending_attempts === 1
        ? []
        : active_attempts.slice(-(input.max_pending_attempts - 1));
      const updated: SessionRecord = {
        ...current,
        authentication_attempts: [...retained_attempts, input.attempt],
      };
      const reference_at = later_date(
        current.last_seen_at,
        input.attempt.created_at,
      );
      const commit = await this.#kv.native_atomic()
        .check(loaded.entry)
        .set(
          record_key(input.session_id),
          structuredClone(updated),
          expiry_options(updated, reference_at),
        )
        .commit();
      if (commit.ok) return { ok: true };
    }
    throw new Error("session attempt save remained contended");
  }

  consume_authentication_attempt(
    input: RepositoryAuthenticationAttemptConsume,
  ): Promise<RepositoryAuthenticationAttemptConsumeResult> {
    return this.#consume_authentication_attempt(structuredClone(input));
  }

  async #consume_authentication_attempt(
    input: RepositoryAuthenticationAttemptConsume,
  ): Promise<RepositoryAuthenticationAttemptConsumeResult> {
    for (let update = 0; update < max_update_attempts; update++) {
      const loaded = await this.#load_record(input.session_id);
      if (
        loaded === null || loaded.record.revoked_at !== null ||
        loaded.record.session_version !== input.expected_version
      ) {
        return { ok: false, reason: "stale_session" };
      }
      const current = loaded.record;
      if (current.kind !== "guest") {
        return { ok: false, reason: "not_guest" };
      }
      const active_attempts = current.authentication_attempts.filter(
        (attempt) => attempt.expires_at > input.consumed_at,
      );
      const matched_index = active_attempts.findIndex((attempt) =>
        attempt.strategy_id === input.strategy_id &&
        attempt.state_hash === input.state_hash
      );
      const attempts = matched_index < 0
        ? active_attempts
        : active_attempts.filter((_, index) => index !== matched_index);
      if (
        matched_index < 0 &&
        attempts.length === current.authentication_attempts.length
      ) {
        return { ok: false, reason: "not_found" };
      }
      const updated: SessionRecord = {
        ...current,
        authentication_attempts: attempts,
      };
      const reference_at = later_date(
        current.last_seen_at,
        input.consumed_at,
      );
      const commit = await this.#kv.native_atomic()
        .check(loaded.entry)
        .set(
          record_key(input.session_id),
          structuredClone(updated),
          expiry_options(updated, reference_at),
        )
        .commit();
      if (!commit.ok) continue;
      if (matched_index < 0) return { ok: false, reason: "not_found" };
      return {
        ok: true,
        attempt: structuredClone(active_attempts[matched_index]),
      };
    }
    throw new Error("session attempt consumption remained contended");
  }

  upgrade(input: SessionUpgrade): Promise<RepositoryUpgradeResult> {
    return this.#upgrade(structuredClone(input));
  }

  async #upgrade(input: SessionUpgrade): Promise<RepositoryUpgradeResult> {
    const new_index_key = credential_key(input.credential_hash);
    for (let update = 0; update < max_update_attempts; update++) {
      const loaded = await this.#load_record(input.session_id);
      if (
        loaded === null || loaded.record.revoked_at !== null ||
        loaded.record.session_version !== input.expected_version
      ) {
        return { ok: false, reason: "stale_session" };
      }
      const new_index = await this.#kv.get<unknown>(new_index_key);
      if (new_index.versionstamp !== null) {
        deserialize_credential_index(new_index.value);
        const current_entry = await this.#kv.get<unknown>(
          record_key(input.session_id),
        );
        if (current_entry.versionstamp !== loaded.entry.versionstamp) continue;
        return { ok: false, reason: "credential_collision" };
      }
      const current = loaded.record;
      const upgraded: SessionRecord = {
        kind: "authenticated",
        session_id: current.session_id,
        session_version: current.session_version + 1,
        user_id: input.user_id,
        created_at: new Date(current.created_at),
        last_seen_at: new Date(input.authenticated_at),
        authenticated_at: new Date(input.authenticated_at),
        absolute_expires_at: new Date(input.absolute_expires_at),
        idle_expires_at: new Date(input.idle_expires_at),
        csrf_token: input.csrf_token,
        credential_hash: input.credential_hash,
        revoked_at: null,
        authentication_attempts: [],
      };
      const expires = expiry_options(upgraded, input.authenticated_at);
      const commit = await this.#kv.native_atomic()
        .check(loaded.entry)
        .check(new_index)
        .delete(credential_key(current.credential_hash))
        .set(record_key(input.session_id), structuredClone(upgraded), expires)
        .set(
          new_index_key,
          serialize_credential_index(input.session_id),
          expires,
        )
        .commit();
      if (commit.ok) {
        return {
          ok: true,
          record: structuredClone(upgraded),
        };
      }
    }
    throw new Error("session upgrade remained contended");
  }

  logout(input: RepositoryLogout): Promise<RepositoryLogoutResult> {
    return this.#logout(structuredClone(input));
  }

  async #logout(input: RepositoryLogout): Promise<RepositoryLogoutResult> {
    for (let update = 0; update < max_update_attempts; update++) {
      const loaded = await this.#load_record(input.session_id);
      if (
        loaded === null || loaded.record.revoked_at !== null ||
        loaded.record.session_version !== input.expected_version
      ) {
        return { ok: false, reason: "stale_session" };
      }
      const current = loaded.record;
      if (current.kind !== "authenticated") {
        return { ok: false, reason: "not_authenticated" };
      }
      if (!csrf_tokens_match(current.csrf_token, input.csrf_token)) {
        return { ok: false, reason: "invalid_csrf" };
      }
      const revoked: SessionRecord = {
        ...current,
        session_version: current.session_version + 1,
        revoked_at: new Date(input.logged_out_at),
        authentication_attempts: [],
      };
      const commit = await this.#kv.native_atomic()
        .check(loaded.entry)
        .delete(credential_key(current.credential_hash))
        .set(
          record_key(input.session_id),
          structuredClone(revoked),
          expiry_options(revoked, input.logged_out_at),
        )
        .commit();
      if (commit.ok) return { ok: true };
    }
    throw new Error("session logout remained contended");
  }

  revoke(
    session_id: string,
    expected_version: number,
    revoked_at: Date,
  ): Promise<boolean> {
    return this.#revoke(
      session_id,
      expected_version,
      new Date(revoked_at),
    );
  }

  async #revoke(
    session_id: string,
    expected_version: number,
    revoked_at: Date,
  ): Promise<boolean> {
    for (let update = 0; update < max_update_attempts; update++) {
      const loaded = await this.#load_record(session_id);
      if (
        loaded === null || loaded.record.revoked_at !== null ||
        loaded.record.session_version !== expected_version
      ) {
        return false;
      }
      const current = loaded.record;
      const revoked: SessionRecord = {
        ...current,
        session_version: current.session_version + 1,
        revoked_at: new Date(revoked_at),
        authentication_attempts: [],
      };
      const commit = await this.#kv.native_atomic()
        .check(loaded.entry)
        .delete(credential_key(current.credential_hash))
        .set(
          record_key(session_id),
          structuredClone(revoked),
          expiry_options(revoked, revoked_at),
        )
        .commit();
      if (commit.ok) return true;
    }
    throw new Error("session revocation remained contended");
  }

  async #load_record(session_id: string): Promise<LoadedRecord | null> {
    const entry = await this.#kv.get<unknown>(record_key(session_id));
    if (entry.versionstamp === null) return null;
    const record = deserialize_record(entry.value);
    if (record.session_id !== session_id) {
      throw new Error("session repository invariant violated");
    }
    return { entry, record };
  }
}
