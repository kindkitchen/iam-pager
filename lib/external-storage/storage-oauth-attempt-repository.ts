import type { KvRecordGateway } from "../storage/kv-gateway.ts";

export interface StorageOAuthAttempt {
  readonly state_hash: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly callback_url: string;
  readonly attempt_context: string;
  readonly created_at: Date;
  readonly expires_at: Date;
}

export interface StorageOAuthAttemptRepository {
  save(attempt: StorageOAuthAttempt): Promise<boolean>;
  consume(
    state_hash: string,
    session_id: string,
    user_id: string,
    consumed_at: Date,
  ): Promise<StorageOAuthAttempt | null>;
}

/** Process-local reference store. Raw OAuth state is never retained. */
export class MemoryStorageOAuthAttemptRepository
  implements StorageOAuthAttemptRepository {
  readonly #attempts = new Map<string, StorageOAuthAttempt>();

  save(attempt: StorageOAuthAttempt): Promise<boolean> {
    if (this.#attempts.has(attempt.state_hash)) return Promise.resolve(false);
    this.#attempts.set(attempt.state_hash, clone_attempt(attempt));
    return Promise.resolve(true);
  }

  consume(
    state_hash: string,
    session_id: string,
    user_id: string,
    consumed_at: Date,
  ): Promise<StorageOAuthAttempt | null> {
    const attempt = this.#attempts.get(state_hash);
    if (attempt === undefined) return Promise.resolve(null);
    if (
      attempt.session_id !== session_id || attempt.user_id !== user_id ||
      consumed_at >= attempt.expires_at
    ) return Promise.resolve(null);
    this.#attempts.delete(state_hash);
    return Promise.resolve(clone_attempt(attempt));
  }
}

export class DenoKvStorageOAuthAttemptRepository
  implements StorageOAuthAttemptRepository {
  readonly #kv: KvRecordGateway;
  readonly #prefix: Deno.KvKey = [
    "iam-pager",
    "storage-oauth-attempts",
    "google-drive",
  ];

  constructor(kv: KvRecordGateway) {
    this.#kv = kv;
  }

  async save(attempt: StorageOAuthAttempt): Promise<boolean> {
    const key = [...this.#prefix, attempt.state_hash];
    const existing = await this.#kv.get(key);
    if (existing.versionstamp !== null) return false;
    const expire_in = Math.max(1, attempt.expires_at.getTime() - Date.now());
    const result = await this.#kv.native_atomic().check(existing).set(
      key,
      clone_attempt(attempt),
      { expireIn: expire_in },
    ).commit();
    return result.ok;
  }

  async consume(
    state_hash: string,
    session_id: string,
    user_id: string,
    consumed_at: Date,
  ): Promise<StorageOAuthAttempt | null> {
    const key = [...this.#prefix, state_hash];
    for (let attempt_number = 0; attempt_number < 8; attempt_number++) {
      const entry = await this.#kv.get<StorageOAuthAttempt>(key);
      if (entry.versionstamp === null) return null;
      const attempt = entry.value;
      if (
        attempt.state_hash !== state_hash ||
        attempt.session_id !== session_id ||
        attempt.user_id !== user_id || !(attempt.created_at instanceof Date) ||
        !(attempt.expires_at instanceof Date) ||
        consumed_at >= attempt.expires_at
      ) return null;
      const result = await this.#kv.native_atomic().check(entry).delete(key)
        .commit();
      if (result.ok) return clone_attempt(attempt);
    }
    throw new Error("storage OAuth attempt consumption remained contended");
  }
}

function clone_attempt(attempt: StorageOAuthAttempt): StorageOAuthAttempt {
  return {
    ...attempt,
    created_at: new Date(attempt.created_at),
    expires_at: new Date(attempt.expires_at),
  };
}
