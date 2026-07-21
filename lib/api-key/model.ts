/**
 * API-key domain model. Keys are owner credentials for the `/api/**`
 * automation surface: they are not browser sessions, carry no CSRF token,
 * and never authenticate site or direct-content routes.
 */

/** Explicit grants; `all` is input shorthand only and is stored expanded. */
export const api_key_permissions = ["read", "write", "delete"] as const;

export type ApiKeyPermission = (typeof api_key_permissions)[number];

export const api_key_label_max_length = 64;

/** Bearer wire shape: fixed prefix plus a 256-bit base64url secret. */
export const api_key_bearer_prefix = "iamp_";

const bearer_pattern = /^iamp_[A-Za-z0-9_-]{43}$/;

const id_pattern = /^[A-Za-z0-9_-]{1,64}$/;

/** Persistence shape. Only the secret's hash is ever stored. */
export interface ApiKeyRecord {
  readonly api_key_id: string;
  readonly owner_user_id: string;
  readonly label: string;
  /** Explicit permissions in canonical order; never contains `all`. */
  readonly permissions: readonly ApiKeyPermission[];
  /** One-way lookup hash of the bearer secret; the bearer itself is absent. */
  readonly secret_hash: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  /** `null` means the key never expires. */
  readonly expires_at: Date | null;
  /** Optimistic revision for metadata updates; starts at 1. */
  readonly revision: number;
}

/** Expired keys stay browser-manageable but can no longer authenticate. */
export type ApiKeyStatus = "active" | "expired";

/** Owner-safe metadata; structurally unable to carry the bearer. */
export interface ApiKeyMetadata {
  readonly api_key_id: string;
  readonly owner_user_id: string;
  readonly label: string;
  readonly permissions: readonly ApiKeyPermission[];
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly expires_at: Date | null;
  readonly revision: number;
  readonly status: ApiKeyStatus;
}

/** The resolved actor behind a valid bearer; consumed by API authorization. */
export interface ApiKeyPrincipal {
  readonly kind: "api_key";
  readonly api_key_id: string;
  readonly user_id: string;
  readonly permissions: readonly ApiKeyPermission[];
}

export function is_valid_api_key_id(value: string): boolean {
  return id_pattern.test(value);
}

/** Cheap structural check before any hashing or lookup happens. */
export function is_well_formed_bearer(value: string): boolean {
  return bearer_pattern.test(value);
}

export function is_valid_api_key_label(value: string): boolean {
  if (value.length === 0 || value.length > api_key_label_max_length) {
    return false;
  }
  // deno-lint-ignore no-control-regex
  return !/[\x00-\x1f\x7f]/.test(value);
}

export type PermissionNormalization =
  | { ok: true; permissions: readonly ApiKeyPermission[] }
  | { ok: false; detail: string };

/**
 * Validate and canonicalize a permission request. `["all"]` alone expands to
 * the complete current explicit set so future permissions are never granted
 * silently; duplicates and unknown values are rejected, and the result is
 * always in canonical `read, write, delete` order.
 */
export function normalize_api_key_permissions(
  input: readonly string[],
): PermissionNormalization {
  if (input.length === 0) {
    return { ok: false, detail: "permissions must not be empty" };
  }
  if (input.includes("all")) {
    if (input.length !== 1) {
      return { ok: false, detail: "all must be the only permission" };
    }
    return { ok: true, permissions: [...api_key_permissions] };
  }
  const seen = new Set<ApiKeyPermission>();
  for (const candidate of input) {
    if (!(api_key_permissions as readonly string[]).includes(candidate)) {
      return { ok: false, detail: `unknown permission: ${candidate}` };
    }
    const permission = candidate as ApiKeyPermission;
    if (seen.has(permission)) {
      return { ok: false, detail: `duplicate permission: ${candidate}` };
    }
    seen.add(permission);
  }
  return {
    ok: true,
    permissions: api_key_permissions.filter((permission) =>
      seen.has(permission)
    ),
  };
}

export function api_key_status(
  record: Pick<ApiKeyRecord, "expires_at">,
  now: Date,
): ApiKeyStatus {
  return record.expires_at !== null && record.expires_at <= now
    ? "expired"
    : "active";
}

/** True when the key may authenticate a bearer request right now. */
export function api_key_authenticates(
  record: Pick<ApiKeyRecord, "expires_at">,
  now: Date,
): boolean {
  return api_key_status(record, now) === "active";
}

export function api_key_metadata(
  record: ApiKeyRecord,
  now: Date,
): ApiKeyMetadata {
  return {
    api_key_id: record.api_key_id,
    owner_user_id: record.owner_user_id,
    label: record.label,
    permissions: record.permissions,
    created_at: record.created_at,
    updated_at: record.updated_at,
    expires_at: record.expires_at,
    revision: record.revision,
    status: api_key_status(record, now),
  };
}

/**
 * Stable public order for owned keys — oldest first, then ID — so API
 * responses never depend on repository iteration.
 */
export function sort_api_key_metadata(
  keys: readonly ApiKeyMetadata[],
): ApiKeyMetadata[] {
  return [...keys].sort((left, right) =>
    left.created_at.getTime() - right.created_at.getTime() ||
    compare_text(left.api_key_id, right.api_key_id)
  );
}

function compare_text(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
