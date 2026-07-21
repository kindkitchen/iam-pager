import type {
  ApiKeyRepository,
  ApiKeyRepositoryUpdate,
  ApiKeyRepositoryUpdateResult,
  RevokeApiKeyResult,
} from "./interfaces.ts";
import type { ApiKeyRecord } from "./model.ts";

/**
 * Map-backed reference implementation. Atomicity holds because every mutation
 * is synchronous with no await between check and write, so overlapping calls
 * serialize on the event loop. Records are returned as copies so callers can
 * never mutate stored state.
 */
export class MemoryApiKeyRepository implements ApiKeyRepository {
  #records = new Map<string, ApiKeyRecord>();
  #by_secret_hash = new Map<string, string>();

  create(record: ApiKeyRecord): Promise<boolean> {
    if (
      this.#records.has(record.api_key_id) ||
      this.#by_secret_hash.has(record.secret_hash)
    ) {
      return Promise.resolve(false);
    }
    this.#records.set(record.api_key_id, clone(record));
    this.#by_secret_hash.set(record.secret_hash, record.api_key_id);
    return Promise.resolve(true);
  }

  find_by_id(api_key_id: string): Promise<ApiKeyRecord | null> {
    const record = this.#records.get(api_key_id);
    return Promise.resolve(record === undefined ? null : clone(record));
  }

  find_by_secret_hash(secret_hash: string): Promise<ApiKeyRecord | null> {
    const api_key_id = this.#by_secret_hash.get(secret_hash);
    if (api_key_id === undefined) return Promise.resolve(null);
    return this.find_by_id(api_key_id);
  }

  list_by_owner(owner_user_id: string): Promise<ApiKeyRecord[]> {
    return Promise.resolve(
      [...this.#records.values()]
        .filter((record) => record.owner_user_id === owner_user_id)
        .map(clone),
    );
  }

  update(
    input: ApiKeyRepositoryUpdate,
  ): Promise<ApiKeyRepositoryUpdateResult> {
    const record = this.#records.get(input.api_key_id);
    if (record === undefined || record.owner_user_id !== input.owner_user_id) {
      return Promise.resolve({ ok: false, reason: "not_found" });
    }
    if (record.revision !== input.expected_revision) {
      return Promise.resolve({ ok: false, reason: "stale_revision" });
    }
    const updated: ApiKeyRecord = {
      ...record,
      label: input.label,
      permissions: [...input.permissions],
      expires_at: input.expires_at,
      updated_at: input.updated_at,
      revision: record.revision + 1,
    };
    this.#records.set(updated.api_key_id, updated);
    return Promise.resolve({ ok: true, record: clone(updated) });
  }

  revoke(
    api_key_id: string,
    owner_user_id: string,
    expected_revision: number,
  ): Promise<RevokeApiKeyResult> {
    const record = this.#records.get(api_key_id);
    if (record === undefined || record.owner_user_id !== owner_user_id) {
      return Promise.resolve({ ok: false, reason: "not_found" });
    }
    if (record.revision !== expected_revision) {
      return Promise.resolve({ ok: false, reason: "stale_revision" });
    }
    this.#records.delete(api_key_id);
    this.#by_secret_hash.delete(record.secret_hash);
    return Promise.resolve({ ok: true });
  }

  revoke_all_by_owner(owner_user_id: string): Promise<number> {
    let revoked = 0;
    for (const record of [...this.#records.values()]) {
      if (record.owner_user_id !== owner_user_id) continue;
      this.#records.delete(record.api_key_id);
      this.#by_secret_hash.delete(record.secret_hash);
      revoked++;
    }
    return Promise.resolve(revoked);
  }
}

function clone(record: ApiKeyRecord): ApiKeyRecord {
  return {
    ...record,
    permissions: [...record.permissions],
    created_at: new Date(record.created_at),
    updated_at: new Date(record.updated_at),
    expires_at: record.expires_at === null ? null : new Date(record.expires_at),
  };
}
