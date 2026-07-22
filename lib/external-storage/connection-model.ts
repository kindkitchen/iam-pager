import { is_external_connection_id, is_external_provider_id } from "./model.ts";

export const storage_connection_statuses = ["active", "revoked"] as const;
export type StorageConnectionStatus =
  (typeof storage_connection_statuses)[number];

export const max_storage_provider_subject_length = 512;
export const max_storage_scope_count = 32;
export const max_storage_scope_length = 512;
export const max_storage_token_length = 16_384;

/** Owner-safe metadata for one creator/provider account link. */
export interface StorageConnection {
  readonly connection_id: string;
  readonly user_id: string;
  readonly provider_id: string;
  readonly provider_subject: string;
  readonly scopes: readonly string[];
  readonly status: StorageConnectionStatus;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** Server-only provider credentials. This type never enters management models. */
export interface StorageConnectionCredentials {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly access_token_expires_at?: Date;
}

export function storage_connection_violation(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "storage connection must be an object";
  }
  const candidate = value as Record<string, unknown>;
  if (
    !has_exact_keys(candidate, [
      "connection_id",
      "user_id",
      "provider_id",
      "provider_subject",
      "scopes",
      "status",
      "created_at",
      "updated_at",
    ])
  ) {
    return "storage connection contains unknown or missing fields";
  }
  if (!is_external_connection_id(candidate.connection_id)) {
    return "connection_id must be a route-safe opaque ID";
  }
  if (!is_bounded_text(candidate.user_id, 128)) {
    return "user_id must be non-empty bounded text without controls";
  }
  if (!is_external_provider_id(candidate.provider_id)) {
    return "provider_id must be a route-safe lowercase ID";
  }
  if (
    !is_bounded_text(
      candidate.provider_subject,
      max_storage_provider_subject_length,
    )
  ) {
    return "provider_subject must be non-empty bounded text without controls";
  }
  if (!is_scope_set(candidate.scopes)) {
    return "scopes must be a non-empty unique set of bounded values";
  }
  if (
    !(storage_connection_statuses as readonly unknown[]).includes(
      candidate.status,
    )
  ) {
    return "status must be active or revoked";
  }
  if (!is_valid_date(candidate.created_at)) {
    return "created_at must be a valid date";
  }
  if (
    !is_valid_date(candidate.updated_at) ||
    candidate.updated_at < candidate.created_at
  ) {
    return "updated_at must be a valid date not before created_at";
  }
  return null;
}

export function is_storage_connection(
  value: unknown,
): value is StorageConnection {
  return storage_connection_violation(value) === null;
}

export function storage_connection_credentials_violation(
  value: unknown,
): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "storage credentials must be an object";
  }
  const candidate = value as Record<string, unknown>;
  if (
    !has_exact_keys(
      candidate,
      ["access_token"],
      ["refresh_token", "access_token_expires_at"],
    )
  ) {
    return "storage credentials contain unknown or missing fields";
  }
  if (!is_bounded_token(candidate.access_token)) {
    return "access_token must be non-empty bounded text";
  }
  if (
    candidate.refresh_token !== undefined &&
    !is_bounded_token(candidate.refresh_token)
  ) {
    return "refresh_token must be non-empty bounded text when present";
  }
  if (
    candidate.access_token_expires_at !== undefined &&
    !is_valid_date(candidate.access_token_expires_at)
  ) {
    return "access_token_expires_at must be a valid date when present";
  }
  return null;
}

export function is_storage_connection_credentials(
  value: unknown,
): value is StorageConnectionCredentials {
  return storage_connection_credentials_violation(value) === null;
}

export function assert_storage_connection(
  value: unknown,
): asserts value is StorageConnection {
  const violation = storage_connection_violation(value);
  if (violation !== null) throw new TypeError(violation);
}

export function assert_storage_connection_credentials(
  value: unknown,
): asserts value is StorageConnectionCredentials {
  const violation = storage_connection_credentials_violation(value);
  if (violation !== null) throw new TypeError(violation);
}

export function clone_storage_connection(
  connection: StorageConnection,
): StorageConnection {
  return {
    connection_id: connection.connection_id,
    user_id: connection.user_id,
    provider_id: connection.provider_id,
    provider_subject: connection.provider_subject,
    scopes: [...connection.scopes],
    status: connection.status,
    created_at: new Date(connection.created_at),
    updated_at: new Date(connection.updated_at),
  };
}

export function clone_storage_connection_credentials(
  credentials: StorageConnectionCredentials,
): StorageConnectionCredentials {
  return {
    access_token: credentials.access_token,
    ...(credentials.refresh_token === undefined
      ? {}
      : { refresh_token: credentials.refresh_token }),
    ...(credentials.access_token_expires_at === undefined ? {} : {
      access_token_expires_at: new Date(credentials.access_token_expires_at),
    }),
  };
}

function has_exact_keys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

function is_scope_set(value: unknown): value is readonly string[] {
  if (
    !Array.isArray(value) || value.length === 0 ||
    value.length > max_storage_scope_count
  ) return false;
  if (
    !value.every((scope) => is_bounded_text(scope, max_storage_scope_length))
  ) return false;
  return new Set(value).size === value.length;
}

function is_bounded_token(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= max_storage_token_length;
}

function is_bounded_text(value: unknown, max_length: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= max_length && !contains_control_character(value);
}

function contains_control_character(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function is_valid_date(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
