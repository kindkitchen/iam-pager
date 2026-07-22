import type {
  StorageConnection,
  StorageConnectionCredentials,
} from "./connection-model.ts";

export type StorageConnectionCreateResult =
  | { readonly ok: true; readonly connection: StorageConnection }
  | {
    readonly ok: false;
    readonly reason: "connection_id_conflict" | "active_connection_conflict";
  };

export interface StorageConnectionReauthorization {
  readonly connection_id: string;
  readonly user_id: string;
  readonly provider_subject: string;
  readonly scopes: readonly string[];
  readonly credentials: StorageConnectionCredentials;
  readonly updated_at: Date;
}

export type StorageConnectionReauthorizationResult =
  | { readonly ok: true; readonly connection: StorageConnection }
  | {
    readonly ok: false;
    readonly reason:
      | "not_found"
      | "provider_subject_mismatch"
      | "active_connection_conflict";
  };

/**
 * Persistence boundary for creator-owned provider connections and server-only
 * credentials. Implementations must pass
 * `test_storage_connection_repository_conformance` unchanged.
 *
 * Connection records never contain token material. `create` atomically enforces
 * one active connection per (user_id, provider_id). `revoke` retains owner-safe
 * metadata while atomically removing the active lookup and credentials.
 */
export interface StorageConnectionRepository {
  create(connection: StorageConnection): Promise<StorageConnectionCreateResult>;
  find_by_id(connection_id: string): Promise<StorageConnection | null>;
  find_active_by_user_provider(
    user_id: string,
    provider_id: string,
  ): Promise<StorageConnection | null>;
  list_by_user(user_id: string): Promise<StorageConnection[]>;

  /**
   * Atomically replaces credentials and granted scopes for the same provider
   * subject. A revoked record becomes active again only when its user/provider
   * active slot is still free.
   */
  reauthorize(
    input: StorageConnectionReauthorization,
  ): Promise<StorageConnectionReauthorizationResult>;

  /** Owner-scoped, idempotent revocation; null hides foreign and missing IDs. */
  revoke(
    connection_id: string,
    user_id: string,
    revoked_at: Date,
  ): Promise<StorageConnection | null>;

  /** Provider-only credential access; null also covers revoked connections. */
  get_credentials(
    connection_id: string,
  ): Promise<StorageConnectionCredentials | null>;
  /** Replaces credentials only while the connection remains active. */
  put_credentials(
    connection_id: string,
    credentials: StorageConnectionCredentials,
  ): Promise<boolean>;
}
