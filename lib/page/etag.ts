import { is_valid_page_id, is_valid_page_revision } from "./model.ts";

export interface PageEtag {
  readonly page_id: string;
  readonly revision: number;
}

const page_etag_pattern = /^"page-([A-Za-z0-9_-]{1,64})-r([1-9][0-9]*)"$/;

/** Produce the strong validator for one managed page representation. */
export function format_page_etag(page_id: string, revision: number): string {
  if (!is_valid_page_id(page_id) || !is_valid_page_revision(revision)) {
    throw new Error("cannot format an invalid page ETag");
  }
  return `"page-${page_id}-r${revision}"`;
}

/**
 * Parse exactly one strong page ETag. Weak, wildcard, lists, whitespace,
 * padded revisions, invalid ids, and unsafe revisions are rejected.
 */
export function parse_page_etag(value: string | null): PageEtag | null {
  if (value === null) return null;
  const match = page_etag_pattern.exec(value);
  if (match === null) return null;
  const revision = Number(match[2]);
  if (!is_valid_page_revision(revision)) return null;
  return { page_id: match[1], revision };
}
