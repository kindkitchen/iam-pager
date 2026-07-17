import type {
  RepositoryUpgradeResult,
  SessionRepository,
  SessionUpgrade,
} from "./interfaces.ts";
import type { SessionRecord } from "./model.ts";

/** Process-local session storage. A restart invalidates every session. */
export class MemorySessionRepository implements SessionRepository {
  #records = new Map<string, SessionRecord>();
  #credential_index = new Map<string, string>();

  find_by_credential_hash(
    credential_hash: string,
  ): Promise<SessionRecord | null> {
    const session_id = this.#credential_index.get(credential_hash);
    if (session_id === undefined) return Promise.resolve(null);
    const record = this.#records.get(session_id);
    return Promise.resolve(record === undefined ? null : clone_record(record));
  }

  create(record: SessionRecord): Promise<boolean> {
    if (
      this.#records.has(record.session_id) ||
      this.#credential_index.has(record.credential_hash)
    ) {
      return Promise.resolve(false);
    }
    const stored = clone_record(record);
    this.#records.set(stored.session_id, stored);
    this.#credential_index.set(stored.credential_hash, stored.session_id);
    return Promise.resolve(true);
  }

  renew(
    session_id: string,
    expected_version: number,
    last_seen_at: Date,
    idle_expires_at?: Date,
  ): Promise<SessionRecord | null> {
    const current = this.#records.get(session_id);
    if (
      current === undefined || current.revoked_at !== null ||
      current.session_version !== expected_version
    ) {
      return Promise.resolve(null);
    }

    const next_last_seen = current.last_seen_at < last_seen_at
      ? new Date(last_seen_at)
      : new Date(current.last_seen_at);
    const updated: SessionRecord = current.kind === "guest"
      ? { ...current, last_seen_at: next_last_seen }
      : {
        ...current,
        last_seen_at: next_last_seen,
        idle_expires_at: idle_expires_at !== undefined &&
            current.idle_expires_at < idle_expires_at
          ? new Date(idle_expires_at)
          : new Date(current.idle_expires_at),
      };
    this.#records.set(session_id, updated);
    return Promise.resolve(clone_record(updated));
  }

  upgrade(input: SessionUpgrade): Promise<RepositoryUpgradeResult> {
    const current = this.#records.get(input.session_id);
    if (
      current === undefined || current.revoked_at !== null ||
      current.session_version !== input.expected_version
    ) {
      return Promise.resolve({ ok: false, reason: "stale_session" });
    }
    if (this.#credential_index.has(input.credential_hash)) {
      // Rotation must reject even this session's current hash: otherwise the
      // pre-upgrade bearer would remain valid after a generator collision.
      return Promise.resolve({ ok: false, reason: "credential_collision" });
    }

    this.#credential_index.delete(current.credential_hash);
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
      credential_hash: input.credential_hash,
      revoked_at: null,
    };
    this.#records.set(upgraded.session_id, upgraded);
    this.#credential_index.set(
      upgraded.credential_hash,
      upgraded.session_id,
    );
    return Promise.resolve({ ok: true, record: clone_record(upgraded) });
  }

  revoke(
    session_id: string,
    expected_version: number,
    revoked_at: Date,
  ): Promise<boolean> {
    const current = this.#records.get(session_id);
    if (
      current === undefined || current.revoked_at !== null ||
      current.session_version !== expected_version
    ) {
      return Promise.resolve(false);
    }
    this.#credential_index.delete(current.credential_hash);
    this.#records.set(session_id, {
      ...current,
      session_version: current.session_version + 1,
      revoked_at: new Date(revoked_at),
    });
    return Promise.resolve(true);
  }

  /** Operational visibility without exposing mutable repository state. */
  get size(): number {
    return this.#records.size;
  }
}

function clone_record(record: SessionRecord): SessionRecord {
  const common = {
    session_id: record.session_id,
    session_version: record.session_version,
    created_at: new Date(record.created_at),
    last_seen_at: new Date(record.last_seen_at),
    absolute_expires_at: new Date(record.absolute_expires_at),
    credential_hash: record.credential_hash,
    revoked_at: record.revoked_at === null ? null : new Date(record.revoked_at),
  };
  return record.kind === "guest" ? { kind: "guest", ...common } : {
    kind: "authenticated",
    ...common,
    user_id: record.user_id,
    authenticated_at: new Date(record.authenticated_at),
    idle_expires_at: new Date(record.idle_expires_at),
  };
}
