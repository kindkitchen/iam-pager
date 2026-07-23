import { decode_base64url, encode_base64url } from "../base64url.ts";
import type { Locator } from "../locator/model.ts";
import { is_valid_page_id, type PageId } from "./model.ts";

/** Locale-independent position used by every deterministic page listing. */
export interface PageSortKey {
  namespace_key: string;
  /** 0 for the namespace default page, 1 for named pages. */
  default_rank: 0 | 1;
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
    page_name_key: page_name?.toLowerCase() ?? "",
    page_id: record.page_id,
  };
}

export function compare_page_sort_keys(a: PageSortKey, b: PageSortKey): number {
  return compare_text(a.namespace_key, b.namespace_key) ||
    a.default_rank - b.default_rank ||
    compare_text(a.page_name_key, b.page_name_key) ||
    compare_text(a.page_id, b.page_id);
}

function compare_text(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Bound on an opaque cursor before decoding. */
export const max_page_list_cursor_length = 1024;

const cursor_charset = /^[A-Za-z0-9_-]+$/;
const sort_key_fields = [
  "namespace_key",
  "default_rank",
  "page_name_key",
  "page_id",
] as const;

type CursorScope = Readonly<Record<string, string | boolean | null>>;

function encode_cursor(
  kind: string,
  last: PageSortKey,
  scope: CursorScope,
): string {
  return encode_base64url(
    new TextEncoder().encode(JSON.stringify({ kind, ...last, ...scope })),
  );
}

function decode_cursor(
  raw: string,
  kind: string,
  scope: CursorScope,
): PageSortKey | null {
  const record = decode_cursor_record(raw);
  if (record === null) return null;
  const expected_fields = ["kind", ...sort_key_fields, ...Object.keys(scope)];
  if (
    Object.keys(record).length !== expected_fields.length ||
    !expected_fields.every((field) => Object.hasOwn(record, field)) ||
    record.kind !== kind ||
    !Object.entries(scope).every(([field, value]) => record[field] === value)
  ) {
    return null;
  }
  return decode_sort_key(record);
}

function decode_cursor_record(raw: string): Record<string, unknown> | null {
  if (
    raw === "" || raw.length > max_page_list_cursor_length ||
    !cursor_charset.test(raw)
  ) {
    return null;
  }
  try {
    const bytes = decode_base64url(raw);
    if (bytes === null) return null;
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    return typeof parsed === "object" && parsed !== null &&
        !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function decode_sort_key(record: Record<string, unknown>): PageSortKey | null {
  const { namespace_key, default_rank, page_name_key, page_id } = record;
  if (
    typeof namespace_key !== "string" || namespace_key === "" ||
    namespace_key !== namespace_key.toLowerCase() ||
    (default_rank !== 0 && default_rank !== 1) ||
    typeof page_name_key !== "string" ||
    (default_rank === 0 ? page_name_key !== "" : page_name_key === "" ||
      page_name_key !== page_name_key.toLowerCase()) ||
    typeof page_id !== "string" || !is_valid_page_id(page_id)
  ) {
    return null;
  }
  return { namespace_key, default_rank, page_name_key, page_id };
}

/** Namespace-only public-listing cursor. */
export function encode_page_list_cursor(
  last: PageSortKey,
  filter: string | null,
): string {
  return encode_cursor("namespace", last, { namespace: filter });
}

export function decode_page_list_cursor(
  raw: string,
  filter: string | null,
): PageSortKey | null {
  const key = decode_cursor(raw, "namespace", { namespace: filter });
  return key !== null && (filter === null || key.namespace_key === filter)
    ? key
    : null;
}

export interface ManagedPageListCursorScope {
  namespace: string | null;
  page_name_query: string | null;
  access: "public" | "private" | null;
  tag: string | null;
  external_missing: boolean | null;
}

export function encode_managed_page_list_cursor(
  last: PageSortKey,
  scope: ManagedPageListCursorScope,
): string {
  return encode_cursor("managed", last, { ...scope });
}

export function decode_managed_page_list_cursor(
  raw: string,
  scope: ManagedPageListCursorScope,
): PageSortKey | null {
  const key = decode_cursor(raw, "managed", { ...scope });
  return key !== null &&
      (scope.namespace === null || key.namespace_key === scope.namespace)
    ? key
    : null;
}

export interface PageExplorationCursorScope {
  namespace_query: string | null;
  page_name_query: string | null;
  tag: string | null;
}

export function encode_page_exploration_cursor(
  last: PageSortKey,
  scope: PageExplorationCursorScope,
): string {
  return encode_cursor("explore", last, { ...scope });
}

export function decode_page_exploration_cursor(
  raw: string,
  scope: PageExplorationCursorScope,
): PageSortKey | null {
  return decode_cursor(raw, "explore", { ...scope });
}
