import type {
  ApiKeyMetadata,
  ApiKeyPermission,
  ApiKeyPrincipal,
  ApiKeyRecord,
} from "./model.ts";

/** Local structural contracts so the module stays composition-independent. */
export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(): string;
}

/** Produces the random secret part of a bearer; never persisted raw. */
export interface SecretGenerator {
  generate(): string;
}

export interface ApiKeyRepositoryUpdate {
  readonly api_key_id: string;
  readonly owner_user_id: string;
  readonly expected_revision: number;
  readonly label: string;
  readonly permissions: readonly ApiKeyPermission[];
  readonly expires_at: Date | null;
  readonly updated_at: Date;
}

export type ApiKeyRepositoryUpdateResult =
  | { readonly ok: true; readonly record: ApiKeyRecord }
  | { readonly ok: false; readonly reason: "not_found" | "stale_revision" };

/**
 * Storage contract for API keys.
 *
 * Rules every implementation must satisfy:
 *
 * - `create` is atomic and refuses ID or secret-hash collisions instead of
 *   replacing an existing record.
 * - `update` and `revoke` are owner-scoped: a foreign owner observes
 *   `not_found`/false exactly like a missing key.
 * - `update` succeeds only against the expected revision and increments it.
 * - `revoke_all_by_owner` invalidates every key of the owner in one
 *   linearizable step; a revoked key never resolves again.
 * - Only hashes and bounded metadata are stored; the raw bearer never
 *   reaches this layer.
 */
export interface ApiKeyRepository {
  create(record: ApiKeyRecord): Promise<boolean>;
  find_by_id(api_key_id: string): Promise<ApiKeyRecord | null>;
  find_by_secret_hash(secret_hash: string): Promise<ApiKeyRecord | null>;
  list_by_owner(owner_user_id: string): Promise<ApiKeyRecord[]>;
  update(input: ApiKeyRepositoryUpdate): Promise<ApiKeyRepositoryUpdateResult>;
  /** Revision-bound owner-scoped removal. */
  revoke(
    api_key_id: string,
    owner_user_id: string,
    expected_revision: number,
  ): Promise<RevokeApiKeyResult>;
  /** Returns how many keys were revoked. */
  revoke_all_by_owner(owner_user_id: string): Promise<number>;
}

export interface CreateApiKeyRequest {
  readonly owner_user_id: string;
  readonly label: string;
  /** Raw requested permissions; `all` shorthand is accepted here only. */
  readonly permissions: readonly string[];
  readonly expires_at: Date | null;
}

export type CreateApiKeyResult =
  | {
    readonly ok: true;
    readonly api_key: ApiKeyMetadata;
    /** Returned exactly once; unrecoverable afterwards. */
    readonly bearer: string;
  }
  | {
    readonly ok: false;
    readonly reason: "invalid_label" | "invalid_permissions" | "invalid_expiry";
    readonly detail: string;
  };

export interface UpdateApiKeyRequest {
  readonly owner_user_id: string;
  readonly api_key_id: string;
  readonly expected_revision: number;
  readonly label: string;
  readonly permissions: readonly string[];
  readonly expires_at: Date | null;
}

export type UpdateApiKeyResult =
  | { readonly ok: true; readonly api_key: ApiKeyMetadata }
  | {
    readonly ok: false;
    readonly reason: "invalid_label" | "invalid_permissions" | "invalid_expiry";
    readonly detail: string;
  }
  | { readonly ok: false; readonly reason: "not_found" | "stale_revision" };

export type RevokeApiKeyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not_found" | "stale_revision" };

export type RevokeAllApiKeysResult = {
  readonly ok: true;
  readonly revoked_count: number;
};

/**
 * Business contract for the owner API-key lifecycle. Owner isolation,
 * validation, permission expansion, expiry, revisions, and secret handling
 * live here — not in HTTP adapters or UI.
 */
export interface ApiKeyManager {
  create(request: CreateApiKeyRequest): Promise<CreateApiKeyResult>;
  /** Every key owned by the user, in stable public order. */
  list_owned(owner_user_id: string): Promise<ApiKeyMetadata[]>;
  /** Owner-scoped read; foreign and unknown IDs are indistinguishable. */
  inspect(
    owner_user_id: string,
    api_key_id: string,
  ): Promise<ApiKeyMetadata | null>;
  update(request: UpdateApiKeyRequest): Promise<UpdateApiKeyResult>;
  /** Owner-scoped immediate revocation; foreign and unknown IDs match. */
  revoke(
    owner_user_id: string,
    api_key_id: string,
    expected_revision: number,
  ): Promise<RevokeApiKeyResult>;
  /** Atomic revoke-all, including any key that authenticated the request. */
  revoke_all(owner_user_id: string): Promise<RevokeAllApiKeysResult>;
}

/** Resolves a presented bearer into a principal without a browser session. */
export interface ApiKeyBearerResolver {
  /** Null for malformed, unknown, expired, and revoked bearers alike. */
  resolve_bearer(bearer: string): Promise<ApiKeyPrincipal | null>;
}
