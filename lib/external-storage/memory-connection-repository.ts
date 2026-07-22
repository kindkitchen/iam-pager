import {
  assert_storage_connection,
  assert_storage_connection_credentials,
  clone_storage_connection,
  clone_storage_connection_credentials,
  type StorageConnection,
  type StorageConnectionCredentials,
} from "./connection-model.ts";
import type {
  StorageConnectionCreateResult,
  StorageConnectionReauthorization,
  StorageConnectionReauthorizationResult,
  StorageConnectionRepository,
} from "./connection-repository.ts";

/** Process-local reference repository and fault-injectable test double. */
export class MemoryStorageConnectionRepository
  implements StorageConnectionRepository {
  #connections = new Map<string, StorageConnection>();
  #active = new Map<string, string>();
  #credentials = new Map<string, StorageConnectionCredentials>();
  #next_failure: Error | null = null;

  /** Reject exactly the next repository operation with the supplied error. */
  fail_next(error = new Error("injected storage connection failure")): void {
    this.#next_failure = error;
  }

  create(
    connection: StorageConnection,
  ): Promise<StorageConnectionCreateResult> {
    this.#fail_if_requested();
    assert_storage_connection(connection);
    if (connection.status !== "active") {
      throw new TypeError("new storage connections must be active");
    }
    if (this.#connections.has(connection.connection_id)) {
      return Promise.resolve({
        ok: false,
        reason: "connection_id_conflict",
      });
    }
    const active_key = user_provider_key(
      connection.user_id,
      connection.provider_id,
    );
    if (this.#active.has(active_key)) {
      return Promise.resolve({
        ok: false,
        reason: "active_connection_conflict",
      });
    }

    const stored = clone_storage_connection(connection);
    this.#connections.set(stored.connection_id, stored);
    this.#active.set(active_key, stored.connection_id);
    return Promise.resolve({
      ok: true,
      connection: clone_storage_connection(stored),
    });
  }

  find_by_id(connection_id: string): Promise<StorageConnection | null> {
    this.#fail_if_requested();
    const connection = this.#connections.get(connection_id);
    return Promise.resolve(
      connection === undefined ? null : clone_storage_connection(connection),
    );
  }

  find_active_by_user_provider(
    user_id: string,
    provider_id: string,
  ): Promise<StorageConnection | null> {
    this.#fail_if_requested();
    const connection_id = this.#active.get(
      user_provider_key(user_id, provider_id),
    );
    if (connection_id === undefined) return Promise.resolve(null);
    const connection = this.#connections.get(connection_id);
    if (
      connection === undefined || connection.status !== "active" ||
      connection.user_id !== user_id || connection.provider_id !== provider_id
    ) {
      throw new Error("storage connection repository invariant violated");
    }
    return Promise.resolve(clone_storage_connection(connection));
  }

  list_by_user(user_id: string): Promise<StorageConnection[]> {
    this.#fail_if_requested();
    return Promise.resolve(
      [...this.#connections.values()]
        .filter((connection) => connection.user_id === user_id)
        .sort(compare_connections)
        .map(clone_storage_connection),
    );
  }

  reauthorize(
    input: StorageConnectionReauthorization,
  ): Promise<StorageConnectionReauthorizationResult> {
    this.#fail_if_requested();
    assert_storage_connection_credentials(input.credentials);
    if (!is_valid_date(input.updated_at)) {
      throw new TypeError("updated_at must be a valid date");
    }
    const connection = this.#connections.get(input.connection_id);
    if (connection === undefined || connection.user_id !== input.user_id) {
      return Promise.resolve({ ok: false, reason: "not_found" });
    }
    if (connection.provider_subject !== input.provider_subject) {
      return Promise.resolve({
        ok: false,
        reason: "provider_subject_mismatch",
      });
    }
    if (input.updated_at < connection.updated_at) {
      throw new TypeError("updated_at must not precede the stored update");
    }
    const key = user_provider_key(connection.user_id, connection.provider_id);
    const active_connection_id = this.#active.get(key);
    if (
      active_connection_id !== undefined &&
      active_connection_id !== connection.connection_id
    ) {
      return Promise.resolve({
        ok: false,
        reason: "active_connection_conflict",
      });
    }
    const reauthorized: StorageConnection = {
      ...connection,
      scopes: [...input.scopes],
      status: "active",
      updated_at: new Date(input.updated_at),
    };
    assert_storage_connection(reauthorized);
    this.#connections.set(
      reauthorized.connection_id,
      clone_storage_connection(reauthorized),
    );
    this.#active.set(key, reauthorized.connection_id);
    this.#credentials.set(
      reauthorized.connection_id,
      clone_storage_connection_credentials(input.credentials),
    );
    return Promise.resolve({
      ok: true,
      connection: clone_storage_connection(reauthorized),
    });
  }

  revoke(
    connection_id: string,
    user_id: string,
    revoked_at: Date,
  ): Promise<StorageConnection | null> {
    this.#fail_if_requested();
    if (!is_valid_date(revoked_at)) {
      throw new TypeError("revoked_at must be a valid date");
    }
    const connection = this.#connections.get(connection_id);
    if (connection === undefined || connection.user_id !== user_id) {
      return Promise.resolve(null);
    }
    if (connection.status === "revoked") {
      return Promise.resolve(clone_storage_connection(connection));
    }
    if (revoked_at < connection.updated_at) {
      throw new TypeError("revoked_at must not precede updated_at");
    }
    const revoked: StorageConnection = {
      ...connection,
      status: "revoked",
      updated_at: new Date(revoked_at),
    };
    this.#connections.set(connection_id, revoked);
    this.#active.delete(
      user_provider_key(connection.user_id, connection.provider_id),
    );
    this.#credentials.delete(connection_id);
    return Promise.resolve(clone_storage_connection(revoked));
  }

  get_credentials(
    connection_id: string,
  ): Promise<StorageConnectionCredentials | null> {
    this.#fail_if_requested();
    const connection = this.#connections.get(connection_id);
    if (connection === undefined || connection.status !== "active") {
      return Promise.resolve(null);
    }
    const credentials = this.#credentials.get(connection_id);
    return Promise.resolve(
      credentials === undefined
        ? null
        : clone_storage_connection_credentials(credentials),
    );
  }

  put_credentials(
    connection_id: string,
    credentials: StorageConnectionCredentials,
  ): Promise<boolean> {
    this.#fail_if_requested();
    assert_storage_connection_credentials(credentials);
    const connection = this.#connections.get(connection_id);
    if (connection === undefined || connection.status !== "active") {
      return Promise.resolve(false);
    }
    this.#credentials.set(
      connection_id,
      clone_storage_connection_credentials(credentials),
    );
    return Promise.resolve(true);
  }

  #fail_if_requested(): void {
    if (this.#next_failure === null) return;
    const failure = this.#next_failure;
    this.#next_failure = null;
    throw failure;
  }
}

function user_provider_key(user_id: string, provider_id: string): string {
  return JSON.stringify([user_id, provider_id]);
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

function is_valid_date(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
