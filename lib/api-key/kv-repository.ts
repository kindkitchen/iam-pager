import type { KvRecordGateway } from "../storage/kv-gateway.ts";
import { is_exact_record, is_valid_stored_date } from "../storage/record.ts";
import type {
  ApiKeyRepository,
  ApiKeyRepositoryUpdate,
  ApiKeyRepositoryUpdateResult,
  RevokeApiKeyResult,
} from "./interfaces.ts";
import {
  api_key_permissions,
  type ApiKeyPermission,
  type ApiKeyRecord,
  is_valid_api_key_label,
} from "./model.ts";

const max_commit_attempts = 8;

const record_prefix: Deno.KvKey = ["iam-pager", "api-keys", "by-id"];
const secret_prefix: Deno.KvKey = ["iam-pager", "api-keys", "by-secret-hash"];
const owner_prefix: Deno.KvKey = ["iam-pager", "api-keys", "by-owner"];
const generation_prefix: Deno.KvKey = [
  "iam-pager",
  "api-keys",
  "owner-generation",
];

/**
 * Persistence shape: the domain record plus the owner generation captured at
 * creation. A stored key is live only while its generation matches the
 * owner's current generation; `revoke_all_by_owner` bumps that single value,
 * so revocation of unbounded key counts is one linearizable commit.
 */
interface StoredApiKeyRecord extends ApiKeyRecord {
  readonly owner_generation: number;
}

interface StoredSecretIndex {
  readonly api_key_id: string;
}

interface StoredOwnerIndex {
  readonly api_key_id: string;
}

interface StoredOwnerGeneration {
  readonly generation: number;
}

function record_key(api_key_id: string): Deno.KvKey {
  return [...record_prefix, api_key_id];
}

function secret_key(secret_hash: string): Deno.KvKey {
  return [...secret_prefix, secret_hash];
}

function owner_key(owner_user_id: string, api_key_id: string): Deno.KvKey {
  return [...owner_prefix, owner_user_id, api_key_id];
}

function generation_key(owner_user_id: string): Deno.KvKey {
  return [...generation_prefix, owner_user_id];
}

function invalid_record(): never {
  throw new TypeError("invalid stored api key record");
}

function deserialize_record(value: unknown): StoredApiKeyRecord {
  if (
    !is_exact_record(value, [
      "api_key_id",
      "owner_user_id",
      "label",
      "permissions",
      "secret_hash",
      "created_at",
      "updated_at",
      "expires_at",
      "revision",
      "owner_generation",
    ])
  ) invalid_record();
  const stored = value as unknown as StoredApiKeyRecord;
  if (
    typeof stored.api_key_id !== "string" || stored.api_key_id === "" ||
    typeof stored.owner_user_id !== "string" || stored.owner_user_id === "" ||
    typeof stored.label !== "string" || !is_valid_api_key_label(stored.label) ||
    typeof stored.secret_hash !== "string" || stored.secret_hash === "" ||
    !is_valid_stored_date(stored.created_at) ||
    !is_valid_stored_date(stored.updated_at) ||
    stored.updated_at < stored.created_at ||
    (stored.expires_at !== null && !is_valid_stored_date(stored.expires_at)) ||
    !Number.isSafeInteger(stored.revision) || stored.revision < 1 ||
    !Number.isSafeInteger(stored.owner_generation) ||
    stored.owner_generation < 0 ||
    !is_canonical_permissions(stored.permissions)
  ) invalid_record();
  return clone_stored(stored);
}

function is_canonical_permissions(
  value: unknown,
): value is readonly ApiKeyPermission[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const canonical = api_key_permissions.filter((permission) =>
    value.includes(permission)
  );
  return canonical.length === value.length &&
    canonical.every((permission, index) => value[index] === permission);
}

function deserialize_index(value: unknown): string {
  if (!is_exact_record(value, ["api_key_id"])) invalid_record();
  const stored = value as unknown as StoredSecretIndex;
  if (typeof stored.api_key_id !== "string" || stored.api_key_id === "") {
    invalid_record();
  }
  return stored.api_key_id;
}

function deserialize_generation(value: unknown): number {
  if (!is_exact_record(value, ["generation"])) invalid_record();
  const stored = value as unknown as StoredOwnerGeneration;
  if (!Number.isSafeInteger(stored.generation) || stored.generation < 1) {
    invalid_record();
  }
  return stored.generation;
}

function clone_stored(stored: StoredApiKeyRecord): StoredApiKeyRecord {
  return {
    ...stored,
    permissions: [...stored.permissions],
    created_at: new Date(stored.created_at),
    updated_at: new Date(stored.updated_at),
    expires_at: stored.expires_at === null ? null : new Date(stored.expires_at),
  };
}

function domain_record(stored: StoredApiKeyRecord): ApiKeyRecord {
  const { owner_generation: _owner_generation, ...record } = clone_stored(
    stored,
  );
  return record;
}

/**
 * Deno KV API-key persistence. Creation commits the record, its secret-hash
 * lookup, and its owner index in one native atomic operation; updates and
 * individual revocations are versionstamp-checked; owner-wide revocation is a
 * single generation bump that instantly invalidates every live key while
 * later operations lazily purge the dead entries. Only hashes and bounded
 * metadata are stored, and malformed records fail closed.
 */
export class DenoKvApiKeyRepository implements ApiKeyRepository {
  readonly #kv: KvRecordGateway;

  constructor(kv: KvRecordGateway) {
    this.#kv = kv;
  }

  async #generation_entry(
    owner_user_id: string,
  ): Promise<{ entry: Deno.KvEntryMaybe<unknown>; generation: number }> {
    const entry = await this.#kv.get<unknown>(generation_key(owner_user_id));
    return {
      entry,
      generation: entry.versionstamp === null
        ? 0
        : deserialize_generation(entry.value),
    };
  }

  async #is_live(stored: StoredApiKeyRecord): Promise<boolean> {
    const { generation } = await this.#generation_entry(stored.owner_user_id);
    return stored.owner_generation === generation;
  }

  /** Best-effort removal of a key that is already dead or being replaced. */
  async #purge(
    entry: Deno.KvEntryMaybe<unknown>,
    stored: StoredApiKeyRecord,
  ): Promise<void> {
    const operation = this.#kv.native_atomic()
      .check(entry)
      .delete(record_key(stored.api_key_id))
      .delete(owner_key(stored.owner_user_id, stored.api_key_id));
    const secret_entry = await this.#kv.get<unknown>(
      secret_key(stored.secret_hash),
    );
    if (
      secret_entry.versionstamp !== null &&
      deserialize_index(secret_entry.value) === stored.api_key_id
    ) {
      operation.check(secret_entry).delete(secret_key(stored.secret_hash));
    }
    await operation.commit();
  }

  async create(record: ApiKeyRecord): Promise<boolean> {
    for (let attempt = 0; attempt < max_commit_attempts; attempt++) {
      const { entry: generation_entry, generation } = await this
        .#generation_entry(record.owner_user_id);
      const id_entry = await this.#kv.get<unknown>(
        record_key(record.api_key_id),
      );
      const hash_entry = await this.#kv.get<unknown>(
        secret_key(record.secret_hash),
      );

      const stale: StoredApiKeyRecord[] = [];
      if (id_entry.versionstamp !== null) {
        const occupant = deserialize_record(id_entry.value);
        if (await this.#is_live(occupant)) return false;
        stale.push(occupant);
      }
      if (hash_entry.versionstamp !== null) {
        const occupant_id = deserialize_index(hash_entry.value);
        const occupant_entry = await this.#kv.get<unknown>(
          record_key(occupant_id),
        );
        if (occupant_entry.versionstamp === null) invalid_record();
        const occupant = deserialize_record(occupant_entry.value);
        if (occupant.secret_hash !== record.secret_hash) invalid_record();
        if (await this.#is_live(occupant)) return false;
        if (
          !stale.some((known) => known.api_key_id === occupant.api_key_id)
        ) stale.push(occupant);
      }

      const stored: StoredApiKeyRecord = {
        ...record,
        permissions: [...record.permissions],
        created_at: new Date(record.created_at),
        updated_at: new Date(record.updated_at),
        expires_at: record.expires_at === null
          ? null
          : new Date(record.expires_at),
        owner_generation: generation,
      };
      const operation = this.#kv.native_atomic()
        .check(generation_entry)
        .check(id_entry)
        .check(hash_entry);
      for (const occupant of stale) {
        operation
          .delete(record_key(occupant.api_key_id))
          .delete(owner_key(occupant.owner_user_id, occupant.api_key_id));
        if (occupant.secret_hash === record.secret_hash) continue;
        // A stale occupant's hash index may already serve a newer live key.
        const occupant_secret_entry = await this.#kv.get<unknown>(
          secret_key(occupant.secret_hash),
        );
        if (
          occupant_secret_entry.versionstamp !== null &&
          deserialize_index(occupant_secret_entry.value) ===
            occupant.api_key_id
        ) {
          operation
            .check(occupant_secret_entry)
            .delete(secret_key(occupant.secret_hash));
        }
      }
      const commit = await operation
        .set(record_key(stored.api_key_id), stored)
        .set(
          secret_key(stored.secret_hash),
          {
            api_key_id: stored.api_key_id,
          } satisfies StoredSecretIndex,
        )
        .set(
          owner_key(stored.owner_user_id, stored.api_key_id),
          {
            api_key_id: stored.api_key_id,
          } satisfies StoredOwnerIndex,
        )
        .commit();
      if (commit.ok) return true;
    }
    throw new Error("api key creation remained contended");
  }

  async find_by_id(api_key_id: string): Promise<ApiKeyRecord | null> {
    const entry = await this.#kv.get<unknown>(record_key(api_key_id));
    if (entry.versionstamp === null) return null;
    const stored = deserialize_record(entry.value);
    if (stored.api_key_id !== api_key_id) invalid_record();
    if (!await this.#is_live(stored)) {
      await this.#purge(entry, stored);
      return null;
    }
    return domain_record(stored);
  }

  async find_by_secret_hash(secret_hash: string): Promise<ApiKeyRecord | null> {
    const index_entry = await this.#kv.get<unknown>(secret_key(secret_hash));
    if (index_entry.versionstamp === null) return null;
    const api_key_id = deserialize_index(index_entry.value);
    const entry = await this.#kv.get<unknown>(record_key(api_key_id));
    if (entry.versionstamp === null) invalid_record();
    const stored = deserialize_record(entry.value);
    if (
      stored.api_key_id !== api_key_id || stored.secret_hash !== secret_hash
    ) {
      invalid_record();
    }
    if (!await this.#is_live(stored)) {
      await this.#purge(entry, stored);
      return null;
    }
    return domain_record(stored);
  }

  async list_by_owner(owner_user_id: string): Promise<ApiKeyRecord[]> {
    const { generation } = await this.#generation_entry(owner_user_id);
    const records: ApiKeyRecord[] = [];
    for await (
      const index_entry of this.#kv.list<unknown>({
        prefix: [...owner_prefix, owner_user_id],
      })
    ) {
      const api_key_id = deserialize_index(index_entry.value);
      const entry = await this.#kv.get<unknown>(record_key(api_key_id));
      if (entry.versionstamp === null) invalid_record();
      const stored = deserialize_record(entry.value);
      if (
        stored.api_key_id !== api_key_id ||
        stored.owner_user_id !== owner_user_id
      ) invalid_record();
      if (stored.owner_generation !== generation) {
        await this.#purge(entry, stored);
        continue;
      }
      records.push(domain_record(stored));
    }
    return records;
  }

  async update(
    input: ApiKeyRepositoryUpdate,
  ): Promise<ApiKeyRepositoryUpdateResult> {
    for (let attempt = 0; attempt < max_commit_attempts; attempt++) {
      const entry = await this.#kv.get<unknown>(record_key(input.api_key_id));
      if (entry.versionstamp === null) {
        return { ok: false, reason: "not_found" };
      }
      const stored = deserialize_record(entry.value);
      if (stored.api_key_id !== input.api_key_id) invalid_record();
      const { entry: generation_entry, generation } = await this
        .#generation_entry(stored.owner_user_id);
      if (stored.owner_generation !== generation) {
        await this.#purge(entry, stored);
        return { ok: false, reason: "not_found" };
      }
      if (stored.owner_user_id !== input.owner_user_id) {
        return { ok: false, reason: "not_found" };
      }
      if (stored.revision !== input.expected_revision) {
        return { ok: false, reason: "stale_revision" };
      }
      const updated: StoredApiKeyRecord = {
        ...stored,
        label: input.label,
        permissions: [...input.permissions],
        expires_at: input.expires_at === null
          ? null
          : new Date(input.expires_at),
        updated_at: new Date(input.updated_at),
        revision: stored.revision + 1,
      };
      const commit = await this.#kv.native_atomic()
        .check(entry)
        .check(generation_entry)
        .set(record_key(updated.api_key_id), updated)
        .commit();
      if (commit.ok) return { ok: true, record: domain_record(updated) };
    }
    throw new Error("api key update remained contended");
  }

  async revoke(
    api_key_id: string,
    owner_user_id: string,
    expected_revision: number,
  ): Promise<RevokeApiKeyResult> {
    for (let attempt = 0; attempt < max_commit_attempts; attempt++) {
      const entry = await this.#kv.get<unknown>(record_key(api_key_id));
      if (entry.versionstamp === null) {
        return { ok: false, reason: "not_found" };
      }
      const stored = deserialize_record(entry.value);
      if (stored.api_key_id !== api_key_id) invalid_record();
      if (!await this.#is_live(stored)) {
        await this.#purge(entry, stored);
        return { ok: false, reason: "not_found" };
      }
      if (stored.owner_user_id !== owner_user_id) {
        return { ok: false, reason: "not_found" };
      }
      if (stored.revision !== expected_revision) {
        return { ok: false, reason: "stale_revision" };
      }
      const operation = this.#kv.native_atomic()
        .check(entry)
        .delete(record_key(api_key_id))
        .delete(owner_key(owner_user_id, api_key_id));
      const secret_entry = await this.#kv.get<unknown>(
        secret_key(stored.secret_hash),
      );
      if (
        secret_entry.versionstamp !== null &&
        deserialize_index(secret_entry.value) === api_key_id
      ) {
        operation.check(secret_entry).delete(secret_key(stored.secret_hash));
      }
      const commit = await operation.commit();
      if (commit.ok) return { ok: true };
    }
    throw new Error("api key revocation remained contended");
  }

  async revoke_all_by_owner(owner_user_id: string): Promise<number> {
    for (let attempt = 0; attempt < max_commit_attempts; attempt++) {
      const { entry: generation_entry, generation } = await this
        .#generation_entry(owner_user_id);
      const live: {
        entry: Deno.KvEntryMaybe<unknown>;
        stored: StoredApiKeyRecord;
      }[] = [];
      for await (
        const index_entry of this.#kv.list<unknown>({
          prefix: [...owner_prefix, owner_user_id],
        })
      ) {
        const api_key_id = deserialize_index(index_entry.value);
        const entry = await this.#kv.get<unknown>(record_key(api_key_id));
        if (entry.versionstamp === null) invalid_record();
        const stored = deserialize_record(entry.value);
        if (
          stored.api_key_id !== api_key_id ||
          stored.owner_user_id !== owner_user_id
        ) invalid_record();
        if (stored.owner_generation === generation) {
          live.push({ entry, stored });
        }
      }

      const commit = await this.#kv.native_atomic()
        .check(generation_entry)
        .set(
          generation_key(owner_user_id),
          {
            generation: generation + 1,
          } satisfies StoredOwnerGeneration,
        )
        .commit();
      if (!commit.ok) continue;

      // The bump above already revoked everything; purging is only cleanup.
      for (const dead of live) {
        await this.#purge(dead.entry, dead.stored);
      }
      return live.length;
    }
    throw new Error("api key owner revocation remained contended");
  }
}
