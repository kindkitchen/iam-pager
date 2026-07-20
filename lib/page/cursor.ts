import type { Locator } from "../locator/model.ts";
import { is_valid_page_id, type PageId } from "./model.ts";

/**
 * Logical, locale-independent sort position of a page in owner listings:
 * namespace first, the default page before named pages, then page name, with
 * the page id as a final tie breaker. Comparison uses plain code-unit order
 * on the normalized (lowercased) keys.
 */
export interface PageSortKey {
  namespace_key: string;
  /** 0 for the namespace default page, 1 for named pages. */
  default_rank: 0 | 1;
  /** Lowercased page name; empty for the default page. */
  page_name_key: string;
  page_id: string;
}

export function page_sort_key(record: {
  readonly page_id: PageId;
  readonly locator: Locator;
}): PageSortKey {
  const page_name = record.locator.page_name;
  return {
    namespace_key: record.locator.namespace.toLowerCase(),
    default_rank: page_name === undefined ? 0 : 1,
    page_name_key: page_name === undefined ? "" : page_name.toLowerCase(),
    page_id: record.page_id,
  };
}

export function compare_page_sort_keys(a: PageSortKey, b: PageSortKey): number {
  if (a.namespace_key !== b.namespace_key) {
    return a.namespace_key < b.namespace_key ? -1 : 1;
  }
  if (a.default_rank !== b.default_rank) {
    return a.default_rank - b.default_rank;
  }
  if (a.page_name_key !== b.page_name_key) {
    return a.page_name_key < b.page_name_key ? -1 : 1;
  }
  if (a.page_id !== b.page_id) {
    return a.page_id < b.page_id ? -1 : 1;
  }
  return 0;
}

/** Bound on the encoded cursor; anything longer is rejected unopened. */
export const max_page_list_cursor_length = 1024;

const cursor_charset = /^[A-Za-z0-9_-]+$/;

function encode_base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decode_base64url(raw: string): string | null {
  const padded = raw.padEnd(raw.length + ((4 - (raw.length % 4)) % 4), "=");
  try {
    const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Encode the continuation position after `last`, bound to the active
 * namespace filter (normalized, or null). The cursor carries no owner id or
 * secret: every listing is still selected by the server-derived owner.
 */
export function encode_page_list_cursor(
  last: PageSortKey,
  filter: string | null,
): string {
  return encode_base64url(JSON.stringify({
    namespace_key: last.namespace_key,
    default_rank: last.default_rank,
    page_name_key: last.page_name_key,
    page_id: last.page_id,
    filter,
  }));
}

/**
 * Strictly decode a client-supplied cursor for a listing with the given
 * active filter. Invalid charset/padding, oversized input, malformed or
 * incoherent payloads, and filter mismatches all return null.
 */
export function decode_page_list_cursor(
  raw: string,
  filter: string | null,
): PageSortKey | null {
  if (
    raw === "" ||
    raw.length > max_page_list_cursor_length ||
    !cursor_charset.test(raw)
  ) {
    return null;
  }
  const text = decode_base64url(raw);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const expected_keys = [
    "namespace_key",
    "default_rank",
    "page_name_key",
    "page_id",
    "filter",
  ];
  const keys = Object.keys(record);
  if (
    keys.length !== expected_keys.length ||
    !expected_keys.every((key) => keys.includes(key))
  ) {
    return null;
  }
  const { namespace_key, default_rank, page_name_key, page_id } = record;
  if (
    typeof namespace_key !== "string" ||
    namespace_key === "" ||
    namespace_key !== namespace_key.toLowerCase()
  ) {
    return null;
  }
  if (default_rank !== 0 && default_rank !== 1) return null;
  if (typeof page_name_key !== "string") return null;
  if (default_rank === 0 && page_name_key !== "") return null;
  if (
    default_rank === 1 &&
    (page_name_key === "" || page_name_key !== page_name_key.toLowerCase())
  ) {
    return null;
  }
  if (typeof page_id !== "string" || !is_valid_page_id(page_id)) return null;
  if (record.filter !== filter) return null;
  if (filter !== null && namespace_key !== filter) return null;
  return {
    namespace_key,
    default_rank,
    page_name_key,
    page_id,
  };
}

/** Complete filter scope carried by a DS-MANAGE continuation cursor. */
export interface ManagedPageListCursorScope {
  namespace: string | null;
  page_name_query: string | null;
  access: "public" | "private" | null;
  tag: string | null;
}

export function encode_managed_page_list_cursor(
  last: PageSortKey,
  scope: ManagedPageListCursorScope,
): string {
  return encode_base64url(JSON.stringify({
    kind: "managed-v1",
    namespace_key: last.namespace_key,
    default_rank: last.default_rank,
    page_name_key: last.page_name_key,
    page_id: last.page_id,
    namespace: scope.namespace,
    page_name_query: scope.page_name_query,
    access: scope.access,
    tag: scope.tag,
  }));
}

/** Decode a managed cursor only for the exact active filter scope. */
export function decode_managed_page_list_cursor(
  raw: string,
  scope: ManagedPageListCursorScope,
): PageSortKey | null {
  if (
    raw === "" ||
    raw.length > max_page_list_cursor_length ||
    !cursor_charset.test(raw)
  ) {
    return null;
  }
  const text = decode_base64url(raw);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const expected_keys = [
    "kind",
    "namespace_key",
    "default_rank",
    "page_name_key",
    "page_id",
    "namespace",
    "page_name_query",
    "access",
    "tag",
  ];
  const keys = Object.keys(record);
  if (
    keys.length !== expected_keys.length ||
    !expected_keys.every((key) => keys.includes(key)) ||
    record.kind !== "managed-v1" ||
    record.namespace !== scope.namespace ||
    record.page_name_query !== scope.page_name_query ||
    record.access !== scope.access ||
    record.tag !== scope.tag
  ) {
    return null;
  }
  const { namespace_key, default_rank, page_name_key, page_id } = record;
  if (
    typeof namespace_key !== "string" ||
    namespace_key === "" ||
    namespace_key !== namespace_key.toLowerCase()
  ) {
    return null;
  }
  if (default_rank !== 0 && default_rank !== 1) return null;
  if (typeof page_name_key !== "string") return null;
  if (default_rank === 0 && page_name_key !== "") return null;
  if (
    default_rank === 1 &&
    (page_name_key === "" || page_name_key !== page_name_key.toLowerCase())
  ) {
    return null;
  }
  if (typeof page_id !== "string" || !is_valid_page_id(page_id)) return null;
  if (scope.namespace !== null && namespace_key !== scope.namespace) {
    return null;
  }
  return { namespace_key, default_rank, page_name_key, page_id };
}

/** Query scope carried by a DS-EXPLORE continuation cursor. */
export interface PageExplorationCursorScope {
  namespace_query: string | null;
  page_name_query: string | null;
  tag: string | null;
}

/** Encode an exploration position bound to both normalized search fields. */
export function encode_page_exploration_cursor(
  last: PageSortKey,
  scope: PageExplorationCursorScope,
): string {
  return encode_base64url(JSON.stringify({
    kind: "explore-v2",
    namespace_key: last.namespace_key,
    default_rank: last.default_rank,
    page_name_key: last.page_name_key,
    page_id: last.page_id,
    namespace_query: scope.namespace_query,
    page_name_query: scope.page_name_query,
    tag: scope.tag,
  }));
}

/**
 * Strictly decode an exploration cursor. List cursors, malformed payloads, and
 * cursors issued for different query values are rejected.
 */
export function decode_page_exploration_cursor(
  raw: string,
  scope: PageExplorationCursorScope,
): PageSortKey | null {
  if (
    raw === "" ||
    raw.length > max_page_list_cursor_length ||
    !cursor_charset.test(raw)
  ) {
    return null;
  }
  const text = decode_base64url(raw);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const expected_keys = [
    "kind",
    "namespace_key",
    "default_rank",
    "page_name_key",
    "page_id",
    "namespace_query",
    "page_name_query",
    "tag",
  ];
  const keys = Object.keys(record);
  if (
    keys.length !== expected_keys.length ||
    !expected_keys.every((key) => keys.includes(key)) ||
    record.kind !== "explore-v2" ||
    record.namespace_query !== scope.namespace_query ||
    record.page_name_query !== scope.page_name_query ||
    record.tag !== scope.tag
  ) {
    return null;
  }
  const { namespace_key, default_rank, page_name_key, page_id } = record;
  if (
    typeof namespace_key !== "string" ||
    namespace_key === "" ||
    namespace_key !== namespace_key.toLowerCase()
  ) {
    return null;
  }
  if (default_rank !== 0 && default_rank !== 1) return null;
  if (typeof page_name_key !== "string") return null;
  if (default_rank === 0 && page_name_key !== "") return null;
  if (
    default_rank === 1 &&
    (page_name_key === "" || page_name_key !== page_name_key.toLowerCase())
  ) {
    return null;
  }
  if (typeof page_id !== "string" || !is_valid_page_id(page_id)) return null;
  return {
    namespace_key,
    default_rank,
    page_name_key,
    page_id,
  };
}
