import type { ContentMeta } from "../content/model.ts";

/** Opaque, stable, route-safe management identity (independent of locator). */
export type PageId = string;

export type PageAccess = "public" | "private";

/** Canonical lowercase tag attached to a managed page. */
export type PageTag = string;

export const max_page_tags = 10;
export const max_page_tag_length = 32;
const page_tag_pattern = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

/** Normalize one user-supplied tag, or return null when it is not tag-safe. */
export function normalize_page_tag(value: unknown): PageTag | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "" || normalized.length > max_page_tag_length ||
    !page_tag_pattern.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

/**
 * Normalize a bounded tag set into deterministic sorted unique storage form.
 * Input count is bounded before deduplication so oversized requests stay
 * bounded even when they repeat one tag.
 */
export function normalize_page_tags(value: unknown): PageTag[] | null {
  if (!Array.isArray(value) || value.length > max_page_tags) return null;
  const normalized = new Set<PageTag>();
  for (const candidate of value) {
    const tag = normalize_page_tag(candidate);
    if (tag === null) return null;
    normalized.add(tag);
  }
  return [...normalized].sort();
}

/** True only for the canonical sorted unique representation repositories use. */
export function is_valid_page_tags(value: unknown): value is PageTag[] {
  if (!Array.isArray(value) || value.length > max_page_tags) return false;
  let previous: string | null = null;
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      normalize_page_tag(candidate) !== candidate ||
      (previous !== null && candidate <= previous)
    ) {
      return false;
    }
    previous = candidate;
  }
  return true;
}

/**
 * Who stands behind a page. `trial` content is unowned guest output with no
 * guarantee; `managed` content carries the server-resolved creator identity
 * that established it under a reserved namespace.
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

/** Route-safe opaque id: unpadded base64url-ish, bounded length. */
const page_id_pattern = /^[A-Za-z0-9_-]{1,64}$/;

export function is_valid_page_id(value: unknown): value is PageId {
  return typeof value === "string" && page_id_pattern.test(value);
}

export function is_valid_page_access(value: unknown): value is PageAccess {
  return value === "public" || value === "private";
}

export function is_valid_page_revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
