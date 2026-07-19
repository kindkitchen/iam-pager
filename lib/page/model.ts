import type { Locator } from "../locator/model.ts";
import type { ContentMeta } from "../content/model.ts";

/** Opaque, stable, route-safe management identity (independent of locator). */
export type PageId = string;

export type PageAccess = "public" | "private";

/**
 * Who stands behind a page. `trial` content is unowned guest output with no
 * guarantee; `managed` content carries the server-resolved creator identity
 * that established it under a reserved namespace (DS-PROTECT).
 */
export type PageStewardship =
  | { readonly kind: "trial" }
  | { readonly kind: "managed"; readonly owner_user_id: string };

/** Current content of a page: type discriminator, stored data, delivery meta. */
export interface PageContent<Data = unknown> {
  /** Discriminates which ContentTypeHandler owns `data`. */
  content_type: string;
  /** Type-specific stored data, including publish-time derivations. */
  data: Data;
  meta: ContentMeta;
}

/**
 * One stored page. Identity for management is `page_id`; identity for direct
 * delivery is the case-insensitive locator key, while `locator` keeps the
 * publisher-supplied casing for display (DA-LOCATOR). Managed rename can move
 * that locator without changing `page_id`. Timestamps live on the page:
 * metadata-only mutation updates the page, not a content lifecycle.
 */
export interface PageRecord<Data = unknown> {
  page_id: PageId;
  locator: Locator;
  stewardship: PageStewardship;
  access: PageAccess;
  /** Positive safe integer, starting at 1, incremented once per mutation. */
  revision: number;
  content: PageContent<Data>;
  created_at: Date;
  updated_at: Date;
}

/** Route-safe opaque id: unpadded base64url-ish, bounded length. */
const page_id_pattern = /^[A-Za-z0-9_-]{1,64}$/;

export function is_valid_page_id(value: string): boolean {
  return page_id_pattern.test(value);
}

export function is_valid_page_access(value: unknown): value is PageAccess {
  return value === "public" || value === "private";
}

export function is_valid_page_revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function is_valid_date(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * First application-invariant violation of a complete record, or null when it
 * is coherent. Shared by storage implementations to reject impossible records
 * (e.g. a private trial page) instead of interpreting them loosely.
 */
export function page_record_violation(record: PageRecord): string | null {
  if (!is_valid_page_id(record.page_id)) {
    return "page_id must be a route-safe opaque id";
  }
  if (record.locator.namespace === "") {
    return "locator namespace must be non-empty";
  }
  if (
    record.locator.page_name !== undefined && record.locator.page_name === ""
  ) {
    return "locator page_name must be non-empty when present";
  }
  if (!is_valid_page_access(record.access)) {
    return "access must be public or private";
  }
  if (
    record.stewardship.kind !== "trial" &&
    record.stewardship.kind !== "managed"
  ) {
    return "stewardship kind must be trial or managed";
  }
  if (record.stewardship.kind === "trial" && record.access !== "public") {
    return "trial pages must be public";
  }
  if (
    record.stewardship.kind === "managed" &&
    record.stewardship.owner_user_id === ""
  ) {
    return "managed owner_user_id must be non-empty";
  }
  if (!is_valid_page_revision(record.revision)) {
    return "revision must be a positive safe integer";
  }
  if (record.content.content_type === "") {
    return "content_type must be non-empty";
  }
  if (record.content.meta.media_type === "") {
    return "media_type must be non-empty";
  }
  if (
    !Number.isSafeInteger(record.content.meta.size_bytes) ||
    record.content.meta.size_bytes < 0
  ) {
    return "size_bytes must be a non-negative safe integer";
  }
  if (!is_valid_date(record.created_at) || !is_valid_date(record.updated_at)) {
    return "timestamps must be valid dates";
  }
  return null;
}
