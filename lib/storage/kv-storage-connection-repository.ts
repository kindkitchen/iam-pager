import {
  assert_storage_connection,
  assert_storage_connection_credentials,
  clone_storage_connection,
  type StorageConnection,
  type StorageConnectionCredentials,
} from "../external-storage/connection-model.ts";
import type {
  StorageConnectionCreateResult,
  StorageConnectionReauthorization,
  StorageConnectionReauthorizationResult,
  StorageConnectionRepository,
} from "../external-storage/connection-repository.ts";
import type {
  EncryptedStorageCredentials,
  StorageCredentialCipher,
} from "../external-storage/token-cipher.ts";
import type { KvRecordGateway } from "./kv-gateway.ts";
import { is_exact_record } from "./record.ts";

const max_commit_attempts = 8;
const connection_prefix: Deno.KvKey = [
  "iam-pager",
  "storage-connections",
  "by-id",
];
const active_prefix: Deno.KvKey = [
  "iam-pager",
  "storage-connections",
  "active-by-user-provider",
];
const user_prefix: Deno.KvKey = [
  "iam-pager",
  "storage-connections",
  "by-user",
];
const credentials_prefix: Deno.KvKey = [
  "iam-pager",
  "storage-connections",
  "credentials",
];

interface StoredConnectionIndex {
  readonly connection_id: string;
}

type StoredCredentials = EncryptedStorageCredentials;

function connection_key(connection_id: string): Deno.KvKey {
  return [...connection_prefix, connection_id];
}

function active_key(user_id: string, provider_id: string): Deno.KvKey {
  return [...active_prefix, user_id, provider_id];
}

function user_key(user_id: string, connection_id: string): Deno.KvKey {
  return [...user_prefix, user_id, connection_id];
}

function credentials_key(connection_id: string): Deno.KvKey {
  return [...credentials_prefix, connection_id];
}

function invalid_record(): never {
  throw new TypeError("invalid stored storage connection record");
}

function deserialize_connection(value: unknown): StorageConnection {
  if (
    !is_exact_record(value, [
      "connection_id",
      "user_id",
      "provider_id",
      "provider_subject",
      "scopes",
      "status",
      "created_at",
      "updated_at",
    ])
  ) invalid_record();
  try {
    assert_storage_connection(value);
  } catch {
    invalid_record();
  }
  return clone_storage_connection(value);
}

function deserialize_index(value: unknown): string {
  if (!is_exact_record(value, ["connection_id"])) invalid_record();
  const stored = value as unknown as StoredConnectionIndex;
  if (
    typeof stored.connection_id !== "string" ||
    stored.connection_id.length === 0
  ) invalid_record();
  return stored.connection_id;
}

/**
 * Deno KV storage-connection persistence. Metadata, active uniqueness, and
 * owner indexes use native atomic commits. Credential ciphertext is held under
 * a separate key and authenticated to its connection ID by the supplied cipher.
 */
export class DenoKvStorageConnectionRepository
  implements StorageConnectionRepository {
  readonly #kv: KvRecordGateway;
  readonly #cipher: StorageCredentialCipher;

  constructor(kv: KvRecordGateway, cipher: StorageCredentialCipher) {
    this.#kv = kv;
    this.#cipher = cipher;
  }

  async create(
    connection: StorageConnection,
  ): Promise<StorageConnectionCreateResult> {
    assert_storage_connection(connection);
    if (connection.status !== "active") {
      throw new TypeError("new storage connections must be active");
    }
    const stored = clone_storage_connection(connection);
    const stored_connection_key = connection_key(stored.connection_id);
    const stored_active_key = active_key(stored.user_id, stored.provider_id);
    const stored_user_key = user_key(stored.user_id, stored.connection_id);

    for (let attempt = 0; attempt < max_commit_attempts; attempt++) {
      const [id_entry, active_entry, user_entry] = await this.#kv.get_many<
        [unknown, unknown, unknown]
      >([stored_connection_key, stored_active_key, stored_user_key]);
      if (id_entry.versionstamp !== null) {
        deserialize_connection(id_entry.value);
        return { ok: false, reason: "connection_id_conflict" };
      }
      if (active_entry.versionstamp !== null) {
        deserialize_index(active_entry.value);
        return { ok: false, reason: "active_connection_conflict" };
      }
      if (user_entry.versionstamp !== null) invalid_record();

      const index = {
        connection_id: stored.connection_id,
      } satisfies StoredConnectionIndex;
      const commit = await this.#kv.native_atomic()
        .check(id_entry)
        .check(active_entry)
        .check(user_entry)
        .set(stored_connection_key, clone_storage_connection(stored))
        .set(stored_active_key, index)
        .set(stored_user_key, index)
        .commit();
      if (commit.ok) {
        return {
          ok: true,
          connection: clone_storage_connection(stored),
        };
      }
    }
    throw new Error("storage connection creation remained contended");
  }

  async find_by_id(connection_id: string): Promise<StorageConnection | null> {
    const entry = await this.#kv.get<unknown>(connection_key(connection_id));
    if (entry.versionstamp === null) return null;
    const connection = deserialize_connection(entry.value);
    if (connection.connection_id !== connection_id) invalid_record();
    return connection;
  }

  async find_active_by_user_provider(
    user_id: string,
    provider_id: string,
  ): Promise<StorageConnection | null> {
    const stored_active_key = active_key(user_id, provider_id);
    for (let attempt = 0; attempt < max_commit_attempts; attempt++) {
      const index_entry = await this.#kv.get<unknown>(stored_active_key);
      if (index_entry.versionstamp === null) return null;
      const connection_id = deserialize_index(index_entry.value);
      const entry = await this.#kv.get<unknown>(connection_key(connection_id));
      if (entry.versionstamp !== null) {
        const connection = deserialize_connection(entry.value);
        if (
          connection.connection_id === connection_id &&
          connection.user_id === user_id &&
          connection.provider_id === provider_id &&
          connection.status === "active"
        ) return connection;
      }

      // A concurrent revoke/reactivation may change the index between reads.
      const current_index = await this.#kv.get<unknown>(stored_active_key);
      if (current_index.versionstamp !== index_entry.versionstamp) continue;
      invalid_record();
    }
    throw new Error("active storage connection lookup remained contended");
  }

  async list_by_user(user_id: string): Promise<StorageConnection[]> {
    const connections: StorageConnection[] = [];
    for await (
      const index_entry of this.#kv.list<unknown>({
        prefix: [...user_prefix, user_id],
      })
    ) {
      const connection_id = deserialize_index(index_entry.value);
      const entry = await this.#kv.get<unknown>(connection_key(connection_id));
      if (entry.versionstamp === null) invalid_record();
      const connection = deserialize_connection(entry.value);
      if (
        connection.connection_id !== connection_id ||
        connection.user_id !== user_id
      ) invalid_record();
      connections.push(connection);
    }
    return connections.sort(compare_connections);
  }

  async reauthorize(
    input: StorageConnectionReauthorization,
  ): Promise<StorageConnectionReauthorizationResult> {
    assert_storage_connection_credentials(input.credentials);
    if (
      !(input.updated_at instanceof Date) ||
      !Number.isFinite(input.updated_at.getTime())
    ) {
      throw new TypeError("updated_at must be a valid date");
    }
    const encrypted = await this.#cipher.encrypt(
      input.connection_id,
      input.credentials,
    );
    for (let attempt = 0; attempt < max_commit_attempts; attempt++) {
      const entry = await this.#kv.get<unknown>(
        connection_key(input.connection_id),
      );
      if (entry.versionstamp === null) {
        return { ok: false, reason: "not_found" };
      }
      const connection = deserialize_connection(entry.value);
      if (connection.connection_id !== input.connection_id) invalid_record();
      if (connection.user_id !== input.user_id) {
        return { ok: false, reason: "not_found" };
      }
      if (connection.provider_subject !== input.provider_subject) {
        return { ok: false, reason: "provider_subject_mismatch" };
      }
      if (input.updated_at < connection.updated_at) {
        throw new TypeError("updated_at must not precede the stored update");
      }
      const stored_active_key = active_key(
        connection.user_id,
        connection.provider_id,
      );
      const active_entry = await this.#kv.get<unknown>(stored_active_key);
      if (
        active_entry.versionstamp !== null &&
        deserialize_index(active_entry.value) !== connection.connection_id
      ) {
        return { ok: false, reason: "active_connection_conflict" };
      }
      const reauthorized: StorageConnection = {
        ...connection,
        scopes: [...input.scopes],
        status: "active",
        updated_at: new Date(input.updated_at),
      };
      assert_storage_connection(reauthorized);
      const commit = await this.#kv.native_atomic()
        .check(entry)
        .check(active_entry)
        .set(
          connection_key(reauthorized.connection_id),
          clone_storage_connection(reauthorized),
        )
        .set(
          stored_active_key,
          {
            connection_id: reauthorized.connection_id,
          } satisfies StoredConnectionIndex,
        )
        .set(credentials_key(reauthorized.connection_id), encrypted)
        .commit();
      if (commit.ok) {
        return {
          ok: true,
          connection: clone_storage_connection(reauthorized),
        };
      }
    }
    throw new Error("storage connection reauthorization remained contended");
  }

  async revoke(
    connection_id: string,
    user_id: string,
    revoked_at: Date,
  ): Promise<StorageConnection | null> {
    if (
      !(revoked_at instanceof Date) || !Number.isFinite(revoked_at.getTime())
    ) {
      throw new TypeError("revoked_at must be a valid date");
    }
    for (let attempt = 0; attempt < max_commit_attempts; attempt++) {
      const entry = await this.#kv.get<unknown>(connection_key(connection_id));
      if (entry.versionstamp === null) return null;
      const connection = deserialize_connection(entry.value);
      if (connection.connection_id !== connection_id) invalid_record();
      if (connection.user_id !== user_id) return null;
      if (connection.status === "revoked") return connection;
      if (revoked_at < connection.updated_at) {
        throw new TypeError("revoked_at must not precede updated_at");
      }

      const stored_active_key = active_key(
        connection.user_id,
        connection.provider_id,
      );
      const active_entry = await this.#kv.get<unknown>(stored_active_key);
      if (
        active_entry.versionstamp === null ||
        deserialize_index(active_entry.value) !== connection_id
      ) {
        const current_entry = await this.#kv.get<unknown>(
          connection_key(connection_id),
        );
        if (current_entry.versionstamp !== entry.versionstamp) continue;
        invalid_record();
      }
      const revoked: StorageConnection = {
        ...connection,
        status: "revoked",
        updated_at: new Date(revoked_at),
      };
      const commit = await this.#kv.native_atomic()
        .check(entry)
        .check(active_entry)
        .set(connection_key(connection_id), clone_storage_connection(revoked))
        .delete(stored_active_key)
        .delete(credentials_key(connection_id))
        .commit();
      if (commit.ok) return clone_storage_connection(revoked);
    }
    throw new Error("storage connection revocation remained contended");
  }

  async get_credentials(
    connection_id: string,
  ): Promise<StorageConnectionCredentials | null> {
    const [connection_entry, credentials_entry] = await this.#kv.get_many<
      [unknown, unknown]
    >([connection_key(connection_id), credentials_key(connection_id)]);
    if (connection_entry.versionstamp === null) return null;
    const connection = deserialize_connection(connection_entry.value);
    if (connection.connection_id !== connection_id) invalid_record();
    if (connection.status !== "active") {
      if (credentials_entry.versionstamp !== null) invalid_record();
      return null;
    }
    if (credentials_entry.versionstamp === null) return null;
    return await this.#cipher.decrypt(
      connection_id,
      credentials_entry.value as StoredCredentials,
    );
  }

  async put_credentials(
    connection_id: string,
    credentials: StorageConnectionCredentials,
  ): Promise<boolean> {
    assert_storage_connection_credentials(credentials);
    const encrypted = await this.#cipher.encrypt(connection_id, credentials);
    for (let attempt = 0; attempt < max_commit_attempts; attempt++) {
      const entry = await this.#kv.get<unknown>(connection_key(connection_id));
      if (entry.versionstamp === null) return false;
      const connection = deserialize_connection(entry.value);
      if (connection.connection_id !== connection_id) invalid_record();
      if (connection.status !== "active") return false;
      const commit = await this.#kv.native_atomic()
        .check(entry)
        .set(credentials_key(connection_id), encrypted)
        .commit();
      if (commit.ok) return true;
    }
    throw new Error("storage credential update remained contended");
  }
}

function compare_connections(
  left: StorageConnection,
  right: StorageConnection,
): number {
  return left.created_at.getTime() - right.created_at.getTime() ||
    compare_text(left.connection_id, right.connection_id);
}

function compare_text(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
