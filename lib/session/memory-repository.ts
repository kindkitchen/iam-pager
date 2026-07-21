import { csrf_tokens_match } from "../http/csrf.ts";
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

  save_authentication_attempt(
    input: RepositoryAuthenticationAttemptSave,
  ): Promise<RepositoryAuthenticationAttemptSaveResult> {
    const current = this.#records.get(input.session_id);
    if (
      current === undefined || current.revoked_at !== null ||
      current.session_version !== input.expected_version
    ) {
      return Promise.resolve({ ok: false, reason: "stale_session" });
    }
    if (current.kind !== "guest") {
      return Promise.resolve({ ok: false, reason: "not_guest" });
    }

    const active_attempts = current.authentication_attempts.filter((attempt) =>
      attempt.expires_at > input.attempt.created_at
    );
    if (
      active_attempts.some((attempt) =>
        attempt.state_hash === input.attempt.state_hash
      )
    ) {
      return Promise.resolve({ ok: false, reason: "state_collision" });
    }

    const retained_attempts = input.max_pending_attempts === 1
      ? []
      : active_attempts.slice(-(input.max_pending_attempts - 1));
    this.#records.set(input.session_id, {
      ...current,
      authentication_attempts: [
        ...retained_attempts.map(clone_authentication_attempt),
        clone_authentication_attempt(input.attempt),
      ],
    });
    return Promise.resolve({ ok: true });
  }

  consume_authentication_attempt(
    input: RepositoryAuthenticationAttemptConsume,
  ): Promise<RepositoryAuthenticationAttemptConsumeResult> {
    const current = this.#records.get(input.session_id);
    if (
      current === undefined || current.revoked_at !== null ||
      current.session_version !== input.expected_version
    ) {
      return Promise.resolve({ ok: false, reason: "stale_session" });
    }
    if (current.kind !== "guest") {
      return Promise.resolve({ ok: false, reason: "not_guest" });
    }

    const active_attempts = current.authentication_attempts.filter((attempt) =>
      attempt.expires_at > input.consumed_at
    );
    const matched_index = active_attempts.findIndex((attempt) =>
      attempt.strategy_id === input.strategy_id &&
      attempt.state_hash === input.state_hash
    );
    if (matched_index < 0) {
      if (
        active_attempts.length !== current.authentication_attempts.length
      ) {
        this.#records.set(input.session_id, {
          ...current,
          authentication_attempts: active_attempts.map(
            clone_authentication_attempt,
          ),
        });
      }
      return Promise.resolve({ ok: false, reason: "not_found" });
    }

    const attempt = active_attempts[matched_index];
    this.#records.set(input.session_id, {
      ...current,
      authentication_attempts: active_attempts
        .filter((_, index) => index !== matched_index)
        .map(clone_authentication_attempt),
    });
    return Promise.resolve({
      ok: true,
      attempt: clone_authentication_attempt(attempt),
    });
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
      csrf_token: input.csrf_token,
      credential_hash: input.credential_hash,
      revoked_at: null,
      authentication_attempts: [],
    };
    this.#records.set(upgraded.session_id, upgraded);
    this.#credential_index.set(
      upgraded.credential_hash,
      upgraded.session_id,
    );
    return Promise.resolve({ ok: true, record: clone_record(upgraded) });
  }

  logout(input: RepositoryLogout): Promise<RepositoryLogoutResult> {
    const current = this.#records.get(input.session_id);
    if (
      current === undefined || current.revoked_at !== null ||
      current.session_version !== input.expected_version
    ) {
      return Promise.resolve({ ok: false, reason: "stale_session" });
    }
    if (current.kind !== "authenticated") {
      return Promise.resolve({ ok: false, reason: "not_authenticated" });
    }
    if (!csrf_tokens_match(current.csrf_token, input.csrf_token)) {
      return Promise.resolve({ ok: false, reason: "invalid_csrf" });
    }

    this.#credential_index.delete(current.credential_hash);
    this.#records.set(input.session_id, {
      ...current,
      session_version: current.session_version + 1,
      revoked_at: new Date(input.logged_out_at),
      authentication_attempts: [],
    });
    return Promise.resolve({ ok: true });
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
      authentication_attempts: [],
    });
    return Promise.resolve(true);
  }
}

function clone_record(record: SessionRecord): SessionRecord {
  return structuredClone(record);
}

function clone_authentication_attempt(
  attempt: SessionRecord["authentication_attempts"][number],
): SessionRecord["authentication_attempts"][number] {
  return structuredClone(attempt);
}
