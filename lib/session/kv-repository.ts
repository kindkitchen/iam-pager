import type { KvRecordGateway } from "../storage/kv-gateway.ts";
import { session_database_schema_version } from "../storage/schema-versions.ts";
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

const storage_schema_version = session_database_schema_version;
const max_update_attempts = 16;
// Key paths stay stable across value-schema upgrades so uniqueness cannot fork.
const record_prefix: Deno.KvKey = ["iam-pager", "sessions", "by-id"];
const credential_prefix: Deno.KvKey = [
  "iam-pager",
  "sessions",
  "by-credential",
];

interface StoredSessionAuthenticationAttempt {
  readonly strategy_id: string;
  readonly state_hash: string;
  readonly callback_url: string;
  readonly return_to: string;
  readonly attempt_context?: string;
  readonly created_at: string;
  readonly expires_at: string;
}

interface StoredSessionRecord {
  readonly schema_version: 1;
  readonly kind: "guest" | "authenticated";
  readonly session_id: string;
  readonly session_version: number;
  readonly created_at: string;
  readonly last_seen_at: string;
  readonly absolute_expires_at: string;
  readonly credential_hash: string;
  readonly revoked_at: string | null;
  readonly authentication_attempts:
    readonly StoredSessionAuthenticationAttempt[];
  readonly user_id?: string;
  readonly authenticated_at?: string;
  readonly idle_expires_at?: string;
  readonly csrf_token?: string;
}

interface StoredCredentialIndex {
  readonly schema_version: 1;
  readonly session_id: string;
}

function record_key(session_id: string): Deno.KvKey {
  return [...record_prefix, session_id];
}

function credential_key(credential_hash: string): Deno.KvKey {
  return [...credential_prefix, credential_hash];
}

function serialize_attempt(
  attempt: SessionAuthenticationAttempt,
): StoredSessionAuthenticationAttempt {
  return {
    strategy_id: attempt.strategy_id,
    state_hash: attempt.state_hash,
    callback_url: attempt.callback_url,
    return_to: attempt.return_to,
    ...(attempt.attempt_context === undefined
      ? {}
      : { attempt_context: attempt.attempt_context }),
    created_at: attempt.created_at.toISOString(),
    expires_at: attempt.expires_at.toISOString(),
  };
}

function serialize_record(record: SessionRecord): StoredSessionRecord {
  const common = {
    schema_version: storage_schema_version,
    kind: record.kind,
    session_id: record.session_id,
    session_version: record.session_version,
    created_at: record.created_at.toISOString(),
    last_seen_at: record.last_seen_at.toISOString(),
    absolute_expires_at: record.absolute_expires_at.toISOString(),
    credential_hash: record.credential_hash,
    revoked_at: record.revoked_at === null
      ? null
      : record.revoked_at.toISOString(),
    authentication_attempts: record.authentication_attempts.map(
      serialize_attempt,
    ),
  } as const;
  return record.kind === "guest" ? common : {
    ...common,
    user_id: record.user_id,
    authenticated_at: record.authenticated_at.toISOString(),
    idle_expires_at: record.idle_expires_at.toISOString(),
    csrf_token: record.csrf_token,
  };
}

function invalid_record(): never {
  throw new TypeError("invalid stored session record");
}

function stored_date(value: unknown): Date {
  if (typeof value !== "string") return invalid_record();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    return invalid_record();
  }
  return date;
}

function deserialize_attempt(value: unknown): SessionAuthenticationAttempt {
  if (typeof value !== "object" || value === null) return invalid_record();
  const stored = value as Record<string, unknown>;
  if (
    typeof stored.strategy_id !== "string" ||
    stored.strategy_id.length === 0 ||
    typeof stored.state_hash !== "string" || stored.state_hash.length === 0 ||
    typeof stored.callback_url !== "string" ||
    stored.callback_url.length === 0 ||
    typeof stored.return_to !== "string" || stored.return_to.length === 0 ||
    (stored.attempt_context !== undefined &&
      typeof stored.attempt_context !== "string")
  ) {
    return invalid_record();
  }
  const created_at = stored_date(stored.created_at);
  const expires_at = stored_date(stored.expires_at);
  if (expires_at < created_at) return invalid_record();
  return {
    strategy_id: stored.strategy_id,
    state_hash: stored.state_hash,
    callback_url: stored.callback_url,
    return_to: stored.return_to,
    attempt_context: stored.attempt_context as string | undefined,
    created_at,
    expires_at,
  };
}

function deserialize_record(value: unknown): SessionRecord {
  if (typeof value !== "object" || value === null) return invalid_record();
  const stored = value as Record<string, unknown>;
  if (
    stored.schema_version !== storage_schema_version ||
    (stored.kind !== "guest" && stored.kind !== "authenticated") ||
    typeof stored.session_id !== "string" || stored.session_id.length === 0 ||
    !Number.isSafeInteger(stored.session_version) ||
    (stored.session_version as number) <= 0 ||
    typeof stored.credential_hash !== "string" ||
    stored.credential_hash.length === 0 ||
    (stored.revoked_at !== null && typeof stored.revoked_at !== "string") ||
    !Array.isArray(stored.authentication_attempts)
  ) {
    return invalid_record();
  }
  const created_at = stored_date(stored.created_at);
  const last_seen_at = stored_date(stored.last_seen_at);
  const absolute_expires_at = stored_date(stored.absolute_expires_at);
  if (last_seen_at < created_at || absolute_expires_at < created_at) {
    return invalid_record();
  }
  const common = {
    session_id: stored.session_id,
    session_version: stored.session_version as number,
    created_at,
    last_seen_at,
    absolute_expires_at,
    credential_hash: stored.credential_hash,
    revoked_at: stored.revoked_at === null
      ? null
      : stored_date(stored.revoked_at),
    authentication_attempts: stored.authentication_attempts.map(
      deserialize_attempt,
    ),
  };
  if (stored.kind === "guest") return { kind: "guest", ...common };
  if (
    typeof stored.user_id !== "string" || stored.user_id.length === 0 ||
    typeof stored.csrf_token !== "string" || stored.csrf_token.length === 0
  ) {
    return invalid_record();
  }
  const authenticated_at = stored_date(stored.authenticated_at);
  const idle_expires_at = stored_date(stored.idle_expires_at);
  if (
    authenticated_at < created_at || idle_expires_at < authenticated_at ||
    absolute_expires_at < authenticated_at
  ) {
    return invalid_record();
  }
  return {
    kind: "authenticated",
    ...common,
    user_id: stored.user_id,
    authenticated_at,
    idle_expires_at,
    csrf_token: stored.csrf_token,
  };
}

function serialize_credential_index(session_id: string): StoredCredentialIndex {
  return { schema_version: storage_schema_version, session_id };
}

function deserialize_credential_index(value: unknown): StoredCredentialIndex {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("invalid stored session credential index");
  }
  const stored = value as Record<string, unknown>;
  if (
    stored.schema_version !== storage_schema_version ||
    typeof stored.session_id !== "string" || stored.session_id.length === 0
  ) {
    throw new TypeError("invalid stored session credential index");
  }
  return {
    schema_version: storage_schema_version,
    session_id: stored.session_id,
  };
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

function clone_upgrade(input: SessionUpgrade): SessionUpgrade {
  return {
    ...input,
    authenticated_at: new Date(input.authenticated_at),
    absolute_expires_at: new Date(input.absolute_expires_at),
    idle_expires_at: new Date(input.idle_expires_at),
  };
}

function clone_attempt_save(
  input: RepositoryAuthenticationAttemptSave,
): RepositoryAuthenticationAttemptSave {
  return {
    ...input,
    attempt: deserialize_attempt(serialize_attempt(input.attempt)),
  };
}

function clone_attempt_consume(
  input: RepositoryAuthenticationAttemptConsume,
): RepositoryAuthenticationAttemptConsume {
  return { ...input, consumed_at: new Date(input.consumed_at) };
}

function clone_logout(input: RepositoryLogout): RepositoryLogout {
  return { ...input, logged_out_at: new Date(input.logged_out_at) };
}

/** Fixed-length comparison avoids early exit on attacker-controlled input. */
function csrf_tokens_match(expected: string, actual: string): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
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
    const stored = serialize_record(record);
    const cloned = deserialize_record(stored);
    return this.#create(cloned, stored);
  }

  async #create(
    record: SessionRecord,
    stored: StoredSessionRecord,
  ): Promise<boolean> {
    const session_key = record_key(record.session_id);
    const index_key = credential_key(record.credential_hash);
    const [session_entry, index_entry] = await this.#kv.get_many([
      session_key,
      index_key,
    ]);
    if (
      session_entry.versionstamp !== null || index_entry.versionstamp !== null
    ) {
      return false;
    }
    const expires = expiry_options(record, record.created_at);
    const commit = await this.#kv.native_atomic()
      .check(session_entry)
      .check(index_entry)
      .set(session_key, stored, expires)
      .set(
        index_key,
        serialize_credential_index(record.session_id),
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
          serialize_record(updated),
          expiry_options(updated, next_last_seen),
        )
        .commit();
      if (commit.ok) return deserialize_record(serialize_record(updated));
    }
    throw new Error("session renewal remained contended");
  }

  save_authentication_attempt(
    input: RepositoryAuthenticationAttemptSave,
  ): Promise<RepositoryAuthenticationAttemptSaveResult> {
    return this.#save_authentication_attempt(clone_attempt_save(input));
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
          serialize_record(updated),
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
    return this.#consume_authentication_attempt(clone_attempt_consume(input));
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
          serialize_record(updated),
          expiry_options(updated, reference_at),
        )
        .commit();
      if (!commit.ok) continue;
      if (matched_index < 0) return { ok: false, reason: "not_found" };
      return {
        ok: true,
        attempt: deserialize_attempt(
          serialize_attempt(active_attempts[matched_index]),
        ),
      };
    }
    throw new Error("session attempt consumption remained contended");
  }

  upgrade(input: SessionUpgrade): Promise<RepositoryUpgradeResult> {
    return this.#upgrade(clone_upgrade(input));
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
        .set(record_key(input.session_id), serialize_record(upgraded), expires)
        .set(
          new_index_key,
          serialize_credential_index(input.session_id),
          expires,
        )
        .commit();
      if (commit.ok) {
        return {
          ok: true,
          record: deserialize_record(serialize_record(upgraded)),
        };
      }
    }
    throw new Error("session upgrade remained contended");
  }

  logout(input: RepositoryLogout): Promise<RepositoryLogoutResult> {
    return this.#logout(clone_logout(input));
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
          serialize_record(revoked),
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
          serialize_record(revoked),
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
