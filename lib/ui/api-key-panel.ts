import { format_api_key_etag } from "../api-key/etag.ts";
import type { ApiKeyManager } from "../api-key/interfaces.ts";
import {
  api_key_label_max_length,
  api_key_permissions,
  type ApiKeyMetadata,
} from "../api-key/model.ts";
import type { Session } from "../session/model.ts";

/** Permission choices the form renders; order is the canonical wire order. */
export const api_key_permission_choices = api_key_permissions;

/** Input shorthand the web form offers as a full-access shortcut. */
export const api_key_all_permissions_shorthand = "all" as const;

/**
 * Serializable owner-safe key view shared by the server presenter and the
 * island. It is structurally unable to carry the bearer or its hash, and the
 * strong validator is preformatted so components never derive revisions.
 */
export interface ApiKeyPanelKey {
  readonly api_key_id: string;
  readonly label: string;
  readonly permissions: readonly string[];
  readonly status: "active" | "expired";
  /** ISO instant or null for a key that never expires. */
  readonly expires_at: string | null;
  readonly created_at: string;
  readonly revision: number;
  /** Exact `If-Match` value for update and revoke of this representation. */
  readonly etag: string;
}

/** Complete server-owned model for the creator API-key panel. */
export type ApiKeyPanel =
  | { readonly kind: "hidden" }
  | {
    readonly kind: "creator";
    /** Synchronizer token every panel mutation must send back. */
    readonly csrf_token: string;
    readonly api_keys: readonly ApiKeyPanelKey[];
  };

export interface ApiKeyPanelPresenter {
  present(session: Session): Promise<ApiKeyPanel>;
}

export interface CreatorApiKeyPanelPresenterOptions {
  readonly api_keys: ApiKeyManager;
}

/**
 * Keeps session decisions and key loading outside UI components: guests get
 * a hidden panel, creators get trusted form inputs and preformatted
 * validators. The panel never sees bearers — only bounded metadata.
 */
export class CreatorApiKeyPanelPresenter implements ApiKeyPanelPresenter {
  readonly #api_keys: ApiKeyManager;

  constructor(options: CreatorApiKeyPanelPresenterOptions) {
    this.#api_keys = options.api_keys;
  }

  async present(session: Session): Promise<ApiKeyPanel> {
    if (session.kind !== "authenticated") return { kind: "hidden" };
    const owned = await this.#api_keys.list_owned(session.user_id);
    return {
      kind: "creator",
      csrf_token: session.csrf_token,
      api_keys: owned.map((key) => present_panel_key(key)),
    };
  }
}

/** Maps one domain metadata row onto the serializable panel shape. */
export function present_panel_key(key: ApiKeyMetadata): ApiKeyPanelKey {
  return {
    api_key_id: key.api_key_id,
    label: key.label,
    permissions: key.permissions,
    status: key.status,
    expires_at: key.expires_at === null ? null : key.expires_at.toISOString(),
    created_at: key.created_at.toISOString(),
    revision: key.revision,
    etag: format_api_key_etag(key.api_key_id, key.revision),
  };
}

/** What the web form collects before a key is generated or edited. */
export interface ApiKeyPanelDraft {
  readonly label: string;
  /** Explicit permissions, or the single `all` shorthand. */
  readonly permissions: readonly string[];
  /** ISO instant or null; the form maps empty input to null. */
  readonly expires_at: string | null;
}

/**
 * First advisory reason the draft is not submittable, or null. This mirrors
 * the raw domain rules for immediate form feedback; the API remains the
 * authority and re-validates every field.
 */
export function api_key_draft_violation(
  draft: ApiKeyPanelDraft,
  now: Date,
): string | null {
  if (draft.label.trim().length === 0) return "A label is required.";
  if (draft.label.length > api_key_label_max_length) {
    return `Labels are limited to ${api_key_label_max_length} characters.`;
  }
  if (draft.permissions.length === 0) {
    return "Select at least one permission.";
  }
  if (draft.expires_at !== null) {
    const parsed = new Date(draft.expires_at);
    if (Number.isNaN(parsed.getTime())) {
      return "The expiry is not a valid moment in time.";
    }
    if (parsed <= now) return "The expiry must be in the future.";
  }
  return null;
}

export interface PreparedApiKeyRequest {
  readonly url: string;
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly headers: Headers;
  readonly body?: {
    readonly label: string;
    readonly permissions: readonly string[];
    readonly expires_at: string | null;
  };
}

const collection_url = "/api/api-keys";

/** Builds the owner key list request. */
export function prepare_api_key_list_request(): PreparedApiKeyRequest {
  return { url: collection_url, method: "GET", headers: new Headers() };
}

/** Maps form state to the strict create contract. */
export function prepare_api_key_create_request(
  csrf_token: string,
  draft: ApiKeyPanelDraft,
): PreparedApiKeyRequest {
  return {
    url: collection_url,
    method: "POST",
    headers: json_mutation_headers(csrf_token),
    body: draft_body(draft),
  };
}

/** Maps edit state to the revision-bound full-replacement PATCH contract. */
export function prepare_api_key_update_request(
  csrf_token: string,
  key: Pick<ApiKeyPanelKey, "api_key_id" | "etag">,
  draft: ApiKeyPanelDraft,
): PreparedApiKeyRequest {
  return {
    url: `${collection_url}/${encodeURIComponent(key.api_key_id)}`,
    method: "PATCH",
    headers: json_mutation_headers(csrf_token, key.etag),
    body: draft_body(draft),
  };
}

/** Builds the revision-bound individual revoke request. */
export function prepare_api_key_revoke_request(
  csrf_token: string,
  key: Pick<ApiKeyPanelKey, "api_key_id" | "etag">,
): PreparedApiKeyRequest {
  return {
    url: `${collection_url}/${encodeURIComponent(key.api_key_id)}`,
    method: "DELETE",
    headers: mutation_headers(csrf_token, key.etag),
  };
}

/** Builds the bodyless owner revoke-all request. */
export function prepare_api_key_revoke_all_request(
  csrf_token: string,
): PreparedApiKeyRequest {
  return {
    url: collection_url,
    method: "DELETE",
    headers: mutation_headers(csrf_token),
  };
}

/** Validates one key representation crossing the island boundary. */
export function panel_key_from_api(value: unknown): ApiKeyPanelKey | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.api_key_id !== "string" || record.api_key_id === "" ||
    typeof record.label !== "string" ||
    !Array.isArray(record.permissions) ||
    record.permissions.some((entry) => typeof entry !== "string") ||
    (record.status !== "active" && record.status !== "expired") ||
    (record.expires_at !== null && (
      typeof record.expires_at !== "string" ||
      !is_iso_timestamp(record.expires_at)
    )) ||
    typeof record.created_at !== "string" ||
    !is_iso_timestamp(record.created_at) ||
    typeof record.revision !== "number" ||
    !Number.isSafeInteger(record.revision) || record.revision < 1
  ) {
    return null;
  }
  return {
    api_key_id: record.api_key_id,
    label: record.label,
    permissions: [...record.permissions] as string[],
    status: record.status,
    expires_at: record.expires_at as string | null,
    created_at: record.created_at,
    revision: record.revision,
    etag: format_api_key_etag(record.api_key_id, record.revision),
  };
}

/** Validates one complete list response for the island boundary. */
export function panel_key_list_from_api(
  value: unknown,
): ApiKeyPanelKey[] | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || !Array.isArray(record.api_keys)) return null;
  const keys = record.api_keys.map(panel_key_from_api);
  return keys.some((key) => key === null) ? null : keys as ApiKeyPanelKey[];
}

/**
 * One successful create crossing the island boundary. The bearer exists only
 * in this transient value; it must never enter the panel key list, URLs, or
 * any persistent browser storage.
 */
export interface GeneratedApiKey {
  readonly api_key: ApiKeyPanelKey;
  readonly bearer: string;
}

/** Validates the one-time create response for the island boundary. */
export function generated_api_key_from_api(
  value: unknown,
): GeneratedApiKey | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.bearer !== "string") return null;
  const api_key = panel_key_from_api(record.api_key);
  if (api_key === null || record.bearer === "") return null;
  return { api_key, bearer: record.bearer };
}

/** Validates the revoke-all summary for the island boundary. */
export function revoked_count_from_api(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.ok !== true || typeof record.revoked_count !== "number" ||
    !Number.isSafeInteger(record.revoked_count) || record.revoked_count < 0
  ) {
    return null;
  }
  return record.revoked_count;
}

export type ApiKeyPanelFailure =
  | { readonly kind: "stale"; readonly message: string }
  | { readonly kind: "request"; readonly message: string };

/**
 * Maps one failed panel response onto a safe advisory message. Stale
 * revisions are distinguished so the island can refresh its snapshot.
 */
export function api_key_panel_failure(
  status: number,
  body: unknown,
): ApiKeyPanelFailure {
  if (status === 412 || status === 428) {
    return {
      kind: "stale",
      message: "This key changed elsewhere. The list has been refreshed.",
    };
  }
  const detail = typeof body === "object" && body !== null &&
      typeof (body as Record<string, unknown>).detail === "string"
    ? (body as Record<string, unknown>).detail as string
    : null;
  if (status === 401) {
    return {
      kind: "request",
      message: "Your session has ended. Sign in again to manage API keys.",
    };
  }
  return {
    kind: "request",
    message: detail ?? `The request failed (${status}).`,
  };
}

function draft_body(draft: ApiKeyPanelDraft): {
  label: string;
  permissions: readonly string[];
  expires_at: string | null;
} {
  return {
    label: draft.label,
    permissions: draft.permissions,
    expires_at: draft.expires_at,
  };
}

function mutation_headers(csrf_token: string, etag?: string): Headers {
  const headers = new Headers({ "x-csrf-token": csrf_token });
  if (etag !== undefined) headers.set("if-match", etag);
  return headers;
}

function json_mutation_headers(csrf_token: string, etag?: string): Headers {
  const headers = mutation_headers(csrf_token, etag);
  headers.set("content-type", "application/json");
  return headers;
}

function is_iso_timestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
