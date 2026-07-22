/** Stable provider capabilities understood by application orchestration. */
export const external_storage_capabilities = [
  "read",
  "write",
  "delete",
] as const;

export type ExternalStorageCapability =
  (typeof external_storage_capabilities)[number];

export const max_external_provider_id_length = 64;
export const max_external_connection_id_length = 64;
export const max_external_ref_length = 2048;
export const max_external_version_hint_length = 512;

const provider_id_pattern = /^[a-z][a-z0-9-]{0,63}$/;
const connection_id_pattern = /^[A-Za-z0-9_-]{1,64}$/;

/** Local operational pointer to provider-owned immutable content bytes. */
export interface ExternalContentRef {
  readonly provider_id: string;
  readonly connection_id: string;
  /** Provider-native opaque object identity; never exposed publicly. */
  readonly external_ref: string;
  /** Optional provider-native version captured when the object was selected. */
  readonly version_hint?: string;
}

/** Untrusted provider metadata. Local asset facts remain authoritative. */
export interface ExternalContentStat {
  readonly size_bytes: number;
  readonly version_hint?: string;
}

/** Complete bounded provider response; partial and streaming bodies are invalid. */
export interface ExternalContentPayload {
  readonly body: Uint8Array;
  readonly stat: ExternalContentStat;
}

export interface ExternalContentFetchInput {
  readonly content_ref: ExternalContentRef;
  /** Hard application bound; providers must not return a larger body. */
  readonly max_bytes: number;
}

/** Already validated canonical content presented to a writable provider. */
export interface ExternalContentPutInput {
  readonly connection_id: string;
  readonly body: Uint8Array;
  readonly media_type: string;
  readonly download_filename?: string;
}

export type ExternalStorageFailure =
  | { readonly ok: false; readonly reason: "external_content_missing" }
  | {
    readonly ok: false;
    readonly reason: "external_source_unreachable";
    readonly retry_after_seconds?: number;
  };

export type ExternalStorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | ExternalStorageFailure;

export function is_external_provider_id(value: unknown): value is string {
  return typeof value === "string" && provider_id_pattern.test(value);
}

export function is_external_connection_id(value: unknown): value is string {
  return typeof value === "string" && connection_id_pattern.test(value);
}

export function is_external_storage_capability(
  value: unknown,
): value is ExternalStorageCapability {
  return typeof value === "string" &&
    (external_storage_capabilities as readonly string[]).includes(value);
}

export function has_external_storage_capability(
  capabilities: readonly ExternalStorageCapability[],
  capability: ExternalStorageCapability,
): boolean {
  return capabilities.includes(capability);
}

/** First structural violation, or null for one bounded operational pointer. */
export function external_content_ref_violation(
  value: unknown,
): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "external content reference must be an object";
  }
  const candidate = value as Record<string, unknown>;
  if (!is_external_provider_id(candidate.provider_id)) {
    return "provider_id must be a route-safe lowercase ID";
  }
  if (!is_external_connection_id(candidate.connection_id)) {
    return "connection_id must be a route-safe opaque ID";
  }
  if (
    !is_bounded_opaque_text(candidate.external_ref, max_external_ref_length)
  ) {
    return "external_ref must be non-empty bounded text without controls";
  }
  if (
    candidate.version_hint !== undefined &&
    !is_bounded_opaque_text(
      candidate.version_hint,
      max_external_version_hint_length,
    )
  ) {
    return "version_hint must be non-empty bounded text without controls";
  }
  return null;
}

export function is_external_content_ref(
  value: unknown,
): value is ExternalContentRef {
  return external_content_ref_violation(value) === null;
}

export function is_external_fetch_bound(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function is_bounded_opaque_text(value: unknown, max_length: number): boolean {
  return typeof value === "string" && value.length > 0 &&
    value.length <= max_length && !contains_control_character(value);
}

function contains_control_character(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
