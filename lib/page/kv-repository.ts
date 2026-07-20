import { type Locator } from "../locator/model.ts";
import type { KvRecordGateway } from "../storage/kv-gateway.ts";
import { page_database_schema_version } from "../storage/schema-versions.ts";
import {
  compare_page_sort_keys,
  decode_managed_page_list_cursor,
  decode_page_exploration_cursor,
  decode_page_list_cursor,
  encode_managed_page_list_cursor,
  encode_page_exploration_cursor,
  encode_page_list_cursor,
  type ManagedPageListCursorScope,
  page_sort_key,
  type PageExplorationCursorScope,
  type PageSortKey,
} from "./cursor.ts";
import type {
  CreateManagedRequest,
  CreateManagedResult,
  DeleteManagedRequest,
  DeleteManagedResult,
  DuplicateManagedRequest,
  DuplicateManagedResult,
  ExplorePublicRequest,
  ExplorePublicResult,
  ListManagedRequest,
  ListManagedResult,
  ListPublicRequest,
  ListPublicResult,
  PageRepository,
  PutTrialRequest,
  PutTrialResult,
  RenameManagedRequest,
  RenameManagedResult,
  ReplaceManagedRequest,
  ReplaceManagedResult,
} from "./interfaces.ts";
import {
  is_valid_page_access,
  is_valid_page_id,
  is_valid_page_revision,
  is_valid_page_tags,
  page_record_violation,
  type PageContent,
  type PageRecord,
} from "./model.ts";

const storage_schema_version = page_database_schema_version;
const max_attempts = 16;
const by_id_prefix: Deno.KvKey = ["iam-pager", "pages", "by-id"];
const by_locator_prefix: Deno.KvKey = [
  "iam-pager",
  "pages",
  "by-locator",
];
const by_owner_prefix: Deno.KvKey = ["iam-pager", "pages", "by-owner"];
const chunk_prefix: Deno.KvKey = ["iam-pager", "pages", "chunks"];

/** Leaves headroom below Deno KV's 64 KiB value limit. */
export const page_content_chunk_byte_length = 48 * 1024;
/** Bounds one visibility commit to fewer than 100 mutations. */
export const max_page_content_chunks = 80;
const chunk_write_batch_size = 10;

interface StoredLocatorIndex {
  readonly schema_version: 1;
  readonly page_id: string;
}

interface StoredOwnerIndex extends StoredLocatorIndex {
  readonly revision: number;
}

interface StoredPageEnvelope {
  readonly schema_version: 1;
  readonly page_id: string;
  readonly namespace: string;
  readonly page_name?: string;
  readonly stewardship: "trial" | "managed";
  readonly owner_user_id?: string;
  readonly access: "public" | "private";
  /** Optional for backwards-compatible reads of pre-tag schema-v1 records. */
  readonly tags?: readonly string[];
  readonly revision: number;
  readonly content_type: string;
  readonly media_type: string;
  readonly size_bytes: number;
  readonly download_filename?: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly data_encoding: "tagged-json-v1";
  readonly generation: string;
  readonly chunk_count: number;
  readonly data_byte_length: number;
}

interface StoredPageSnapshot {
  readonly entry: Deno.KvEntry<unknown>;
  readonly envelope: StoredPageEnvelope;
}

function require(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`page repository: ${message}`);
}

function invalid_stored_page(): never {
  throw new TypeError("invalid stored page");
}

function invariant_violation(): never {
  throw new Error("page repository invariant violated");
}

function is_valid_time(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function require_normalized_managed_list_request(
  request: ListManagedRequest,
): void {
  if (request.page_name_query !== undefined) {
    require(
      request.page_name_query !== "" &&
        request.page_name_query === request.page_name_query.trim() &&
        request.page_name_query === request.page_name_query.toLowerCase(),
      "page_name_query must be a normalized lowercase substring when present",
    );
  }
  require(
    request.access === undefined || is_valid_page_access(request.access),
    "access filter must be public or private when present",
  );
  require(
    request.tag === undefined || is_valid_page_tags([request.tag]),
    "tag filter must be canonical when present",
  );
}

function matches_managed_list(
  record: PageRecord,
  key: PageSortKey,
  scope: ManagedPageListCursorScope,
): boolean {
  return (scope.namespace === null || key.namespace_key === scope.namespace) &&
    (scope.page_name_query === null ||
      (key.default_rank === 1 &&
        key.page_name_key.includes(scope.page_name_query))) &&
    (scope.access === null || record.access === scope.access) &&
    (scope.tag === null || record.tags.includes(scope.tag));
}

function require_normalized_exploration_request(
  request: ExplorePublicRequest,
): void {
  require(
    Number.isSafeInteger(request.limit) && request.limit >= 1,
    "limit must be a positive safe integer",
  );
  for (
    const [name, query] of [
      ["namespace_query", request.namespace_query],
      ["page_name_query", request.page_name_query],
    ] as const
  ) {
    require(
      query === undefined ||
        (query !== "" && query === query.trim() &&
          query === query.toLowerCase()),
      `${name} must be a normalized lowercase substring when present`,
    );
  }
  require(
    request.tag === undefined || is_valid_page_tags([request.tag]),
    "tag must be canonical when present",
  );
}

function matches_exploration(
  record: PageRecord,
  key: PageSortKey,
  scope: PageExplorationCursorScope,
): boolean {
  return (scope.namespace_query === null ||
    key.namespace_key.includes(scope.namespace_query)) &&
    (scope.page_name_query === null ||
      (key.default_rank === 1 &&
        key.page_name_key.includes(scope.page_name_query))) &&
    (scope.tag === null || record.tags.includes(scope.tag));
}

function normalized_locator(locator: Locator): {
  namespace_key: string;
  default_rank: 0 | 1;
  page_name_key: string;
} {
  return {
    namespace_key: locator.namespace.toLowerCase(),
    default_rank: locator.page_name === undefined ? 0 : 1,
    page_name_key: locator.page_name === undefined
      ? ""
      : locator.page_name.toLowerCase(),
  };
}

function id_key(page_id: string): Deno.KvKey {
  return [...by_id_prefix, page_id];
}

function locator_key(locator: Locator): Deno.KvKey {
  const normalized = normalized_locator(locator);
  return [
    ...by_locator_prefix,
    normalized.namespace_key,
    normalized.default_rank,
    normalized.page_name_key,
  ];
}

function owner_prefix(owner_user_id: string, namespace?: string): Deno.KvKey {
  return namespace === undefined
    ? [...by_owner_prefix, owner_user_id]
    : [...by_owner_prefix, owner_user_id, namespace.toLowerCase()];
}

function owner_key_from_sort_key(
  owner_user_id: string,
  key: PageSortKey,
): Deno.KvKey {
  return [
    ...by_owner_prefix,
    owner_user_id,
    key.namespace_key,
    key.default_rank,
    key.page_name_key,
    key.page_id,
  ];
}

function owner_key(record: PageRecord): Deno.KvKey {
  if (record.stewardship.kind !== "managed") return invariant_violation();
  return owner_key_from_sort_key(
    record.stewardship.owner_user_id,
    page_sort_key(record),
  );
}

function generation_prefix(page_id: string, generation: string): Deno.KvKey {
  return [...chunk_prefix, page_id, generation];
}

function chunk_key(
  page_id: string,
  generation: string,
  index: number,
): Deno.KvKey {
  return [...generation_prefix(page_id, generation), index];
}

function has_exact_keys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

function stored_date(value: unknown): Date {
  if (typeof value !== "string") return invalid_stored_page();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    return invalid_stored_page();
  }
  return date;
}

function deserialize_locator_index(value: unknown): StoredLocatorIndex {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid_stored_page();
  }
  const stored = value as Record<string, unknown>;
  if (
    !has_exact_keys(stored, ["schema_version", "page_id"]) ||
    stored.schema_version !== storage_schema_version ||
    typeof stored.page_id !== "string" ||
    !is_valid_page_id(stored.page_id)
  ) {
    return invalid_stored_page();
  }
  return stored as unknown as StoredLocatorIndex;
}

function deserialize_owner_index(value: unknown): StoredOwnerIndex {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid_stored_page();
  }
  const stored = value as Record<string, unknown>;
  if (
    !has_exact_keys(stored, ["schema_version", "page_id", "revision"]) ||
    stored.schema_version !== storage_schema_version ||
    typeof stored.page_id !== "string" ||
    !is_valid_page_id(stored.page_id) ||
    !is_valid_page_revision(stored.revision)
  ) {
    return invalid_stored_page();
  }
  return stored as unknown as StoredOwnerIndex;
}

function deserialize_envelope(value: unknown): StoredPageEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid_stored_page();
  }
  const stored = value as Record<string, unknown>;
  const required = [
    "schema_version",
    "page_id",
    "namespace",
    "stewardship",
    "access",
    "revision",
    "content_type",
    "media_type",
    "size_bytes",
    "created_at",
    "updated_at",
    "data_encoding",
    "generation",
    "chunk_count",
    "data_byte_length",
  ];
  if (
    !has_exact_keys(stored, required, [
      "page_name",
      "owner_user_id",
      "download_filename",
      "tags",
    ]) ||
    stored.schema_version !== storage_schema_version ||
    typeof stored.page_id !== "string" ||
    !is_valid_page_id(stored.page_id) ||
    typeof stored.namespace !== "string" ||
    stored.namespace === "" ||
    (stored.page_name !== undefined &&
      (typeof stored.page_name !== "string" || stored.page_name === "")) ||
    (stored.stewardship !== "trial" && stored.stewardship !== "managed") ||
    (stored.stewardship === "trial" && stored.owner_user_id !== undefined) ||
    (stored.stewardship === "managed" &&
      (typeof stored.owner_user_id !== "string" ||
        stored.owner_user_id === "")) ||
    !is_valid_page_access(stored.access) ||
    (stored.stewardship === "trial" && stored.access !== "public") ||
    !is_valid_page_tags(stored.tags ?? []) ||
    (stored.stewardship === "trial" && Array.isArray(stored.tags) &&
      stored.tags.length !== 0) ||
    !is_valid_page_revision(stored.revision) ||
    typeof stored.content_type !== "string" ||
    stored.content_type === "" ||
    typeof stored.media_type !== "string" ||
    stored.media_type === "" ||
    typeof stored.size_bytes !== "number" ||
    !Number.isSafeInteger(stored.size_bytes) ||
    stored.size_bytes < 0 ||
    (stored.download_filename !== undefined &&
      typeof stored.download_filename !== "string") ||
    stored.data_encoding !== "tagged-json-v1" ||
    typeof stored.generation !== "string" ||
    !is_valid_page_id(stored.generation) ||
    typeof stored.chunk_count !== "number" ||
    !Number.isSafeInteger(stored.chunk_count) ||
    stored.chunk_count < 1 ||
    stored.chunk_count > max_page_content_chunks ||
    typeof stored.data_byte_length !== "number" ||
    !Number.isSafeInteger(stored.data_byte_length) ||
    stored.data_byte_length < 1 ||
    stored.data_byte_length >
      max_page_content_chunks * page_content_chunk_byte_length
  ) {
    return invalid_stored_page();
  }
  stored_date(stored.created_at);
  stored_date(stored.updated_at);
  return stored as unknown as StoredPageEnvelope;
}

function envelope_locator(envelope: StoredPageEnvelope): Locator {
  return envelope.page_name === undefined
    ? { namespace: envelope.namespace }
    : { namespace: envelope.namespace, page_name: envelope.page_name };
}

function serialize_envelope(
  page: PageRecord,
  generation: string,
  chunk_count: number,
  data_byte_length: number,
): StoredPageEnvelope {
  const violation = page_record_violation(page);
  if (violation !== null) throw new Error(`page repository: ${violation}`);
  return {
    schema_version: storage_schema_version,
    page_id: page.page_id,
    namespace: page.locator.namespace,
    ...(page.locator.page_name === undefined
      ? {}
      : { page_name: page.locator.page_name }),
    stewardship: page.stewardship.kind,
    ...(page.stewardship.kind === "managed"
      ? { owner_user_id: page.stewardship.owner_user_id }
      : {}),
    access: page.access,
    tags: [...page.tags],
    revision: page.revision,
    content_type: page.content.content_type,
    media_type: page.content.meta.media_type,
    size_bytes: page.content.meta.size_bytes,
    ...(page.content.meta.download_filename === undefined
      ? {}
      : { download_filename: page.content.meta.download_filename }),
    created_at: page.created_at.toISOString(),
    updated_at: page.updated_at.toISOString(),
    data_encoding: "tagged-json-v1",
    generation,
    chunk_count,
    data_byte_length,
  };
}

function envelope_page(
  envelope: StoredPageEnvelope,
  data: unknown,
): PageRecord {
  const page: PageRecord = {
    page_id: envelope.page_id,
    locator: envelope_locator(envelope),
    stewardship: envelope.stewardship === "trial"
      ? { kind: "trial" }
      : { kind: "managed", owner_user_id: envelope.owner_user_id! },
    access: envelope.access,
    tags: [...(envelope.tags ?? [])],
    revision: envelope.revision,
    content: {
      content_type: envelope.content_type,
      data,
      meta: {
        media_type: envelope.media_type,
        size_bytes: envelope.size_bytes,
        ...(envelope.download_filename === undefined
          ? {}
          : { download_filename: envelope.download_filename }),
      },
    },
    created_at: stored_date(envelope.created_at),
    updated_at: stored_date(envelope.updated_at),
  };
  if (page_record_violation(page) !== null) invalid_stored_page();
  return page;
}

function bytes_to_base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64url_to_bytes(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    (value !== "" && !/^[A-Za-z0-9_-]+$/.test(value))
  ) {
    return invalid_stored_page();
  }
  const padded = value.padEnd(value.length + ((4 - value.length % 4) % 4), "=");
  try {
    const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );
    if (bytes_to_base64url(bytes) !== value) return invalid_stored_page();
    return bytes;
  } catch {
    return invalid_stored_page();
  }
}

type EncodedData = readonly unknown[];

function encode_data_value(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): EncodedData {
  if (depth > 100) {
    throw new TypeError("page content data exceeds the durable nesting limit");
  }
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number" && Number.isFinite(value)) {
    return ["number", Object.is(value, -0) ? "-0" : String(value)];
  }
  if (value instanceof Uint8Array) {
    return ["bytes", bytes_to_base64url(value)];
  }
  if (typeof value !== "object") {
    throw new TypeError(
      "page content data must be JSON-compatible or Uint8Array",
    );
  }
  if (ancestors.has(value)) {
    throw new TypeError("page content data must not contain cycles");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) {
        throw new TypeError("page content arrays must not be sparse");
      }
      return [
        "array",
        value.map((item) => encode_data_value(item, ancestors, depth + 1)),
      ];
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(
        "page content data must contain only plain objects and Uint8Array",
      );
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError("page content objects must not contain symbol keys");
    }
    return [
      "object",
      Object.entries(value).map(([key, item]) => [
        key,
        encode_data_value(item, ancestors, depth + 1),
      ]),
    ];
  } finally {
    ancestors.delete(value);
  }
}

function decode_data_value(value: unknown, depth: number): unknown {
  if (depth > 100 || !Array.isArray(value) || typeof value[0] !== "string") {
    return invalid_stored_page();
  }
  switch (value[0]) {
    case "null":
      if (value.length !== 1) return invalid_stored_page();
      return null;
    case "string":
      if (value.length !== 2 || typeof value[1] !== "string") {
        return invalid_stored_page();
      }
      return value[1];
    case "boolean":
      if (value.length !== 2 || typeof value[1] !== "boolean") {
        return invalid_stored_page();
      }
      return value[1];
    case "number": {
      if (value.length !== 2 || typeof value[1] !== "string") {
        return invalid_stored_page();
      }
      const number = Number(value[1]);
      if (
        !Number.isFinite(number) ||
        (Object.is(number, -0)
          ? value[1] !== "-0"
          : String(number) !== value[1])
      ) {
        return invalid_stored_page();
      }
      return number;
    }
    case "bytes":
      if (value.length !== 2) return invalid_stored_page();
      return base64url_to_bytes(value[1]);
    case "array":
      if (value.length !== 2 || !Array.isArray(value[1])) {
        return invalid_stored_page();
      }
      return value[1].map((item) => decode_data_value(item, depth + 1));
    case "object": {
      if (value.length !== 2 || !Array.isArray(value[1])) {
        return invalid_stored_page();
      }
      const result: Record<string, unknown> = {};
      const seen = new Set<string>();
      for (const entry of value[1]) {
        if (
          !Array.isArray(entry) || entry.length !== 2 ||
          typeof entry[0] !== "string" || seen.has(entry[0])
        ) {
          return invalid_stored_page();
        }
        seen.add(entry[0]);
        Object.defineProperty(result, entry[0], {
          value: decode_data_value(entry[1], depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    }
    default:
      return invalid_stored_page();
  }
}

function serialize_data(content: PageContent): Uint8Array {
  const encoded = encode_data_value(content.data, new WeakSet(), 0);
  const bytes = new TextEncoder().encode(JSON.stringify(encoded));
  if (
    bytes.length > max_page_content_chunks * page_content_chunk_byte_length
  ) {
    throw new TypeError("page content data exceeds the durable storage limit");
  }
  return bytes;
}

function deserialize_data(bytes: Uint8Array): unknown {
  try {
    return decode_data_value(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      0,
    );
  } catch (error) {
    if (error instanceof TypeError && error.message === "invalid stored page") {
      throw error;
    }
    return invalid_stored_page();
  }
}

function split_chunks(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (
    let offset = 0;
    offset === 0 || offset < bytes.length;
    offset += page_content_chunk_byte_length
  ) {
    chunks.push(bytes.slice(offset, offset + page_content_chunk_byte_length));
  }
  if (chunks.length > max_page_content_chunks) {
    throw new TypeError("page content data exceeds the durable storage limit");
  }
  return chunks;
}

function locator_index(page_id: string): StoredLocatorIndex {
  return { schema_version: storage_schema_version, page_id };
}

function owner_index(page: PageRecord): StoredOwnerIndex {
  return {
    schema_version: storage_schema_version,
    page_id: page.page_id,
    revision: page.revision,
  };
}

function key_equals(a: Deno.KvKey, b: Deno.KvKey): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

/**
 * Deno KV `PageRepository` using one authoritative envelope, coherent locator
 * and owner indexes, and immutable chunk generations in the fresh `pages`
 * keyspace. Content chunks are written before an atomic visibility commit;
 * failed conditions can leave no visible partial page and are cleaned up on a
 * best-effort basis.
 */
export class DenoKvPageRepository implements PageRepository {
  readonly #kv: KvRecordGateway;

  constructor(kv: KvRecordGateway) {
    this.#kv = kv;
  }

  async find_by_locator(locator: Locator): Promise<PageRecord | null> {
    const key = locator_key(locator);
    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      const index_entry = await this.#kv.get<unknown>(key);
      if (index_entry.versionstamp === null) return null;
      const index = deserialize_locator_index(index_entry.value);
      const [current_index, envelope_entry] = await this.#kv.get_many<
        unknown[]
      >(
        [key, id_key(index.page_id)],
      );
      if (current_index.versionstamp !== index_entry.versionstamp) continue;
      if (envelope_entry.versionstamp === null) invariant_violation();
      const envelope = deserialize_envelope(envelope_entry.value);
      this.#assert_envelope_identity(envelope_entry.key, envelope);
      if (!key_equals(locator_key(envelope_locator(envelope)), key)) {
        invariant_violation();
      }
      const page = await this.#read_snapshot({
        entry: envelope_entry,
        envelope,
      });
      if (page === null) continue;
      const final_entries = await this.#kv.get_many<unknown[]>([
        key,
        id_key(index.page_id),
        ...(page.stewardship.kind === "managed" ? [owner_key(page)] : []),
      ]);
      const [final_index, final_envelope, final_owner] = final_entries;
      if (
        final_index.versionstamp === current_index.versionstamp &&
        final_envelope.versionstamp === envelope_entry.versionstamp
      ) {
        const final_locator = deserialize_locator_index(final_index.value);
        if (final_locator.page_id !== page.page_id) invariant_violation();
        if (page.stewardship.kind === "managed") {
          this.#assert_mutation_indexes(
            final_index,
            final_owner,
            envelope,
          );
        }
        return page;
      }
    }
    throw new Error("page repository read contention exhausted retries");
  }

  async find_by_id(page_id: string): Promise<PageRecord | null> {
    require(
      is_valid_page_id(page_id),
      "page_id must be a route-safe opaque id",
    );
    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      const envelope_entry = await this.#kv.get<unknown>(id_key(page_id));
      if (envelope_entry.versionstamp === null) return null;
      const envelope = deserialize_envelope(envelope_entry.value);
      this.#assert_envelope_identity(envelope_entry.key, envelope);
      const page = await this.#read_snapshot({
        entry: envelope_entry,
        envelope,
      });
      if (page === null) continue;
      const final_entries = await this.#kv.get_many<unknown[]>([
        id_key(page_id),
        locator_key(page.locator),
        ...(page.stewardship.kind === "managed" ? [owner_key(page)] : []),
      ]);
      const [final_envelope, locator_entry, owner_entry] = final_entries;
      if (final_envelope.versionstamp !== envelope_entry.versionstamp) continue;
      if (locator_entry.versionstamp === null) invariant_violation();
      const index = deserialize_locator_index(locator_entry.value);
      if (index.page_id !== page_id) invariant_violation();
      if (page.stewardship.kind === "managed") {
        this.#assert_mutation_indexes(locator_entry, owner_entry, envelope);
      }
      return page;
    }
    throw new Error("page repository read contention exhausted retries");
  }

  async list_managed(request: ListManagedRequest): Promise<ListManagedResult> {
    require(
      typeof request.owner_user_id === "string" && request.owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
    require(
      Number.isSafeInteger(request.limit) && request.limit >= 1,
      "limit must be a positive safe integer",
    );
    require(
      request.namespace === undefined ||
        (typeof request.namespace === "string" && request.namespace !== ""),
      "namespace filter must be non-empty when present",
    );
    require_normalized_managed_list_request(request);
    const scope: ManagedPageListCursorScope = {
      namespace: request.namespace?.toLowerCase() ?? null,
      page_name_query: request.page_name_query ?? null,
      access: request.access ?? null,
      tag: request.tag ?? null,
    };
    let after: PageSortKey | null = null;
    if (request.cursor !== undefined) {
      after = decode_managed_page_list_cursor(request.cursor, scope);
      if (after === null) return { ok: false, reason: "invalid_cursor" };
    }
    const prefix = owner_prefix(request.owner_user_id, request.namespace);
    const start = after === null
      ? undefined
      : owner_key_from_sort_key(request.owner_user_id, after);
    const pages: PageRecord[] = [];
    let has_more = false;
    for await (
      const entry of this.#kv.list<unknown>(
        start === undefined ? { prefix } : { prefix, start },
      )
    ) {
      if (start !== undefined && key_equals(entry.key, start)) continue;
      const index = deserialize_owner_index(entry.value);
      const page = await this.find_by_id(index.page_id);
      if (page === null) {
        const current = await this.#kv.get<unknown>(entry.key);
        if (current.versionstamp !== entry.versionstamp) continue;
        invariant_violation();
      }
      if (
        page.stewardship.kind !== "managed" ||
        page.stewardship.owner_user_id !== request.owner_user_id ||
        page.revision !== index.revision ||
        !key_equals(entry.key, owner_key(page)) ||
        (scope.namespace !== null &&
          page_sort_key(page).namespace_key !== scope.namespace)
      ) {
        const current = await this.#kv.get<unknown>(entry.key);
        if (current.versionstamp !== entry.versionstamp) continue;
        invariant_violation();
      }
      const key = page_sort_key(page);
      if (after !== null && compare_page_sort_keys(key, after) <= 0) {
        invariant_violation();
      }
      if (!matches_managed_list(page, key, scope)) continue;
      if (pages.length === request.limit) {
        has_more = true;
        break;
      }
      pages.push(page);
    }
    return {
      ok: true,
      pages,
      next_cursor: has_more
        ? encode_managed_page_list_cursor(
          page_sort_key(pages[pages.length - 1]),
          scope,
        )
        : null,
    };
  }

  async list_public(request: ListPublicRequest): Promise<ListPublicResult> {
    require(
      typeof request.namespace === "string" && request.namespace !== "",
      "namespace must be non-empty",
    );
    require(
      Number.isSafeInteger(request.limit) && request.limit >= 1,
      "limit must be a positive safe integer",
    );
    const filter = request.namespace.toLowerCase();
    let after: PageSortKey | null = null;
    if (request.cursor !== undefined) {
      after = decode_page_list_cursor(request.cursor, filter);
      if (after === null) return { ok: false, reason: "invalid_cursor" };
    }
    const prefix: Deno.KvKey = [...by_locator_prefix, filter];
    const start: Deno.KvKey | undefined = after === null ? undefined : [
      ...by_locator_prefix,
      filter,
      after.default_rank,
      after.page_name_key,
    ];
    const pages: PageRecord[] = [];
    let has_more = false;
    for await (
      const entry of this.#kv.list<unknown>(
        start === undefined ? { prefix } : { prefix, start },
      )
    ) {
      // The continuation cursor names the last delivered locator; resume
      // strictly after it.
      if (start !== undefined && key_equals(entry.key, start)) continue;
      const index = deserialize_locator_index(entry.value);
      const page = await this.find_by_id(index.page_id);
      if (
        page === null || !key_equals(locator_key(page.locator), entry.key)
      ) {
        const current = await this.#kv.get<unknown>(entry.key);
        if (current.versionstamp !== entry.versionstamp) continue;
        invariant_violation();
      }
      // Eligibility, not an invariant: trial and private pages share the
      // locator index but never enter public listings (OQ-ACCESS).
      if (page.stewardship.kind !== "managed" || page.access !== "public") {
        continue;
      }
      if (pages.length === request.limit) {
        has_more = true;
        break;
      }
      pages.push(page);
    }
    return {
      ok: true,
      pages,
      next_cursor: has_more
        ? encode_page_list_cursor(
          page_sort_key(pages[pages.length - 1]),
          filter,
        )
        : null,
    };
  }

  async explore_public(
    request: ExplorePublicRequest,
  ): Promise<ExplorePublicResult> {
    require_normalized_exploration_request(request);
    const scope: PageExplorationCursorScope = {
      namespace_query: request.namespace_query ?? null,
      page_name_query: request.page_name_query ?? null,
      tag: request.tag ?? null,
    };
    let after: PageSortKey | null = null;
    if (request.cursor !== undefined) {
      after = decode_page_exploration_cursor(request.cursor, scope);
      if (after === null) return { ok: false, reason: "invalid_cursor" };
    }
    const prefix = by_locator_prefix;
    const start: Deno.KvKey | undefined = after === null ? undefined : [
      ...prefix,
      after.namespace_key,
      after.default_rank,
      after.page_name_key,
    ];
    const pages: PageRecord[] = [];
    let has_more = false;
    for await (
      const entry of this.#kv.list<unknown>(
        start === undefined ? { prefix } : { prefix, start },
      )
    ) {
      if (start !== undefined && key_equals(entry.key, start)) continue;
      const index = deserialize_locator_index(entry.value);
      const page = await this.find_by_id(index.page_id);
      if (
        page === null || !key_equals(locator_key(page.locator), entry.key)
      ) {
        const current = await this.#kv.get<unknown>(entry.key);
        if (current.versionstamp !== entry.versionstamp) continue;
        invariant_violation();
      }
      const key = page_sort_key(page);
      if (after !== null && compare_page_sort_keys(key, after) <= 0) {
        invariant_violation();
      }
      if (
        page.stewardship.kind !== "managed" || page.access !== "public" ||
        !matches_exploration(page, key, scope)
      ) {
        continue;
      }
      if (pages.length === request.limit) {
        has_more = true;
        break;
      }
      pages.push(page);
    }
    return {
      ok: true,
      pages,
      next_cursor: has_more
        ? encode_page_exploration_cursor(
          page_sort_key(pages[pages.length - 1]),
          scope,
        )
        : null,
    };
  }

  async put_trial(request: PutTrialRequest): Promise<PutTrialResult> {
    require(
      is_valid_page_id(request.page_id),
      "page_id must be a route-safe opaque id",
    );
    require(is_valid_time(request.now), "now must be a valid date");
    const bytes = serialize_data(request.content);
    const chunks = split_chunks(bytes);
    const locator_storage_key = locator_key(request.locator);

    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      const locator_entry = await this.#kv.get<unknown>(locator_storage_key);
      let existing: StoredPageSnapshot | null = null;
      let page_id = request.page_id;
      if (locator_entry.versionstamp !== null) {
        const index = deserialize_locator_index(locator_entry.value);
        const [current_locator, envelope_entry] = await this.#kv.get_many<
          unknown[]
        >(
          [locator_storage_key, id_key(index.page_id)],
        );
        if (current_locator.versionstamp !== locator_entry.versionstamp) {
          continue;
        }
        if (envelope_entry.versionstamp === null) invariant_violation();
        const envelope = deserialize_envelope(envelope_entry.value);
        this.#assert_snapshot_indexes(
          current_locator,
          envelope_entry,
          envelope,
        );
        if (envelope.stewardship === "managed") {
          return { ok: false, reason: "managed_conflict" };
        }
        existing = { entry: envelope_entry, envelope };
        page_id = envelope.page_id;
      } else {
        const page_id_entry = await this.#kv.get<unknown>(id_key(page_id));
        if (page_id_entry.versionstamp !== null) {
          return { ok: false, reason: "page_id_conflict" };
        }
      }

      const page: PageRecord = existing === null
        ? {
          page_id,
          locator: structuredClone(request.locator),
          stewardship: { kind: "trial" },
          access: "public",
          tags: [],
          revision: 1,
          content: structuredClone(request.content),
          created_at: request.now,
          updated_at: request.now,
        }
        : {
          page_id,
          locator: structuredClone(request.locator),
          stewardship: { kind: "trial" },
          access: "public",
          tags: [],
          revision: existing.envelope.revision + 1,
          content: structuredClone(request.content),
          created_at: stored_date(existing.envelope.created_at),
          updated_at: request.now,
        };
      const generation = crypto.randomUUID();
      const envelope = serialize_envelope(
        page,
        generation,
        chunks.length,
        bytes.length,
      );
      await this.#write_chunks(page_id, generation, chunks);
      const page_id_entry = existing?.entry ??
        await this.#kv.get<unknown>(id_key(page_id));
      const atomic = this.#kv.native_atomic()
        .check(locator_entry)
        .check(page_id_entry)
        .set(id_key(page_id), envelope)
        .set(locator_storage_key, locator_index(page_id));
      if (existing !== null) {
        this.#delete_generation(atomic, existing.envelope);
      }
      const commit = await atomic.commit();
      if (commit.ok) {
        return {
          ok: true,
          outcome: existing === null ? "created" : "replaced",
          page,
        };
      }
      await this.#cleanup_generation(page_id, generation, chunks.length);
    }
    throw new Error("page repository write contention exhausted retries");
  }

  async create_managed(
    request: CreateManagedRequest,
  ): Promise<CreateManagedResult> {
    require(
      is_valid_page_id(request.page_id),
      "page_id must be a route-safe opaque id",
    );
    require(
      typeof request.owner_user_id === "string" && request.owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
    require(
      is_valid_page_access(request.access),
      "access must be public or private",
    );
    require(
      is_valid_page_tags(request.tags ?? []),
      "tags must be a bounded canonical sorted unique set",
    );
    require(is_valid_time(request.now), "now must be a valid date");
    const bytes = serialize_data(request.content);
    const chunks = split_chunks(bytes);
    const locator_storage_key = locator_key(request.locator);

    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      const [locator_entry, new_id_entry] = await this.#kv.get_many<unknown[]>([
        locator_storage_key,
        id_key(request.page_id),
      ]);
      let existing: StoredPageSnapshot | null = null;
      if (locator_entry.versionstamp !== null) {
        const index = deserialize_locator_index(locator_entry.value);
        const envelope_entry = await this.#kv.get<unknown>(
          id_key(index.page_id),
        );
        const current_locator = await this.#kv.get<unknown>(
          locator_storage_key,
        );
        if (current_locator.versionstamp !== locator_entry.versionstamp) {
          continue;
        }
        if (envelope_entry.versionstamp === null) invariant_violation();
        const envelope = deserialize_envelope(envelope_entry.value);
        this.#assert_snapshot_indexes(
          current_locator,
          envelope_entry,
          envelope,
        );
        if (envelope.stewardship === "managed") {
          return { ok: false, reason: "managed_conflict" };
        }
        existing = { entry: envelope_entry, envelope };
      }
      if (new_id_entry.versionstamp !== null) {
        return { ok: false, reason: "page_id_conflict" };
      }
      const page: PageRecord = {
        page_id: request.page_id,
        locator: structuredClone(request.locator),
        stewardship: {
          kind: "managed",
          owner_user_id: request.owner_user_id,
        },
        access: request.access,
        tags: [...(request.tags ?? [])],
        revision: 1,
        content: structuredClone(request.content),
        created_at: request.now,
        updated_at: request.now,
      };
      const generation = crypto.randomUUID();
      const envelope = serialize_envelope(
        page,
        generation,
        chunks.length,
        bytes.length,
      );
      await this.#write_chunks(page.page_id, generation, chunks);
      let atomic = this.#kv.native_atomic()
        .check(locator_entry)
        .check(new_id_entry)
        .set(id_key(page.page_id), envelope)
        .set(locator_storage_key, locator_index(page.page_id))
        .set(owner_key(page), owner_index(page));
      if (existing !== null) {
        atomic = atomic.check(existing.entry).delete(existing.entry.key);
        this.#delete_generation(atomic, existing.envelope);
      }
      const commit = await atomic.commit();
      if (commit.ok) {
        return {
          ok: true,
          outcome: existing === null ? "created" : "replaced_trial",
          page,
        };
      }
      await this.#cleanup_generation(page.page_id, generation, chunks.length);
    }
    throw new Error("page repository write contention exhausted retries");
  }

  async replace_managed(
    request: ReplaceManagedRequest,
  ): Promise<ReplaceManagedResult> {
    require(
      is_valid_page_id(request.page_id),
      "page_id must be a route-safe opaque id",
    );
    require(
      typeof request.owner_user_id === "string" && request.owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
    require(
      is_valid_page_revision(request.expected_revision),
      "expected_revision must be a positive safe integer",
    );
    require(
      is_valid_page_access(request.access),
      "access must be public or private",
    );
    require(
      request.tags === undefined || is_valid_page_tags(request.tags),
      "tags must be a bounded canonical sorted unique set",
    );
    require(is_valid_time(request.now), "now must be a valid date");
    const serialized = request.content === undefined
      ? null
      : serialize_data(request.content);
    const chunks = serialized === null ? null : split_chunks(serialized);

    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      const envelope_entry = await this.#kv.get<unknown>(
        id_key(request.page_id),
      );
      if (envelope_entry.versionstamp === null) {
        return { ok: false, reason: "not_found" };
      }
      const envelope = deserialize_envelope(envelope_entry.value);
      this.#assert_envelope_identity(envelope_entry.key, envelope);
      if (
        envelope.stewardship !== "managed" ||
        envelope.owner_user_id !== request.owner_user_id
      ) {
        return { ok: false, reason: "not_found" };
      }
      if (envelope.revision !== request.expected_revision) {
        return { ok: false, reason: "revision_conflict" };
      }
      let existing_page: PageRecord;
      if (request.content === undefined) {
        const read_page = await this.#read_snapshot({
          entry: envelope_entry,
          envelope,
        });
        if (read_page === null) continue;
        existing_page = read_page;
      } else {
        existing_page = envelope_page(envelope, null);
      }
      const existing_owner_key = owner_key(existing_page);
      const [current_envelope, locator_entry, owner_entry] = await this.#kv
        .get_many<unknown[]>([
          envelope_entry.key,
          locator_key(envelope_locator(envelope)),
          existing_owner_key,
        ]);
      if (current_envelope.versionstamp !== envelope_entry.versionstamp) {
        continue;
      }
      this.#assert_mutation_indexes(locator_entry, owner_entry, envelope);
      const page: PageRecord = {
        ...existing_page,
        access: request.access,
        tags: request.tags === undefined
          ? existing_page.tags
          : structuredClone(request.tags),
        revision: envelope.revision + 1,
        content: request.content === undefined
          ? existing_page.content
          : structuredClone(request.content),
        updated_at: request.now,
      };
      let generation = envelope.generation;
      if (serialized !== null && chunks !== null) {
        generation = crypto.randomUUID();
        await this.#write_chunks(page.page_id, generation, chunks);
      }
      const next_envelope = serialize_envelope(
        page,
        generation,
        chunks?.length ?? envelope.chunk_count,
        serialized?.length ?? envelope.data_byte_length,
      );
      const atomic = this.#kv.native_atomic()
        .check(envelope_entry)
        .check(locator_entry)
        .check(owner_entry)
        .set(envelope_entry.key, next_envelope)
        .set(existing_owner_key, owner_index(page));
      if (serialized !== null) this.#delete_generation(atomic, envelope);
      const commit = await atomic.commit();
      if (commit.ok) return { ok: true, page };
      if (serialized !== null && chunks !== null) {
        await this.#cleanup_generation(page.page_id, generation, chunks.length);
      }
    }
    throw new Error("page repository write contention exhausted retries");
  }

  async rename_managed(
    request: RenameManagedRequest,
  ): Promise<RenameManagedResult> {
    require(
      is_valid_page_id(request.page_id),
      "page_id must be a route-safe opaque id",
    );
    require(
      typeof request.owner_user_id === "string" && request.owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
    require(
      is_valid_page_revision(request.expected_revision),
      "expected_revision must be a positive safe integer",
    );
    require(is_valid_time(request.now), "now must be a valid date");

    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      const envelope_entry = await this.#kv.get<unknown>(
        id_key(request.page_id),
      );
      if (envelope_entry.versionstamp === null) {
        return { ok: false, reason: "not_found" };
      }
      const envelope = deserialize_envelope(envelope_entry.value);
      this.#assert_envelope_identity(envelope_entry.key, envelope);
      if (
        envelope.stewardship !== "managed" ||
        envelope.owner_user_id !== request.owner_user_id
      ) {
        return { ok: false, reason: "not_found" };
      }
      require(
        request.locator.namespace.toLowerCase() ===
          envelope.namespace.toLowerCase(),
        "rename must stay within the current namespace",
      );
      if (envelope.revision !== request.expected_revision) {
        return { ok: false, reason: "revision_conflict" };
      }
      const existing_page = await this.#read_snapshot({
        entry: envelope_entry,
        envelope,
      });
      if (existing_page === null) continue;

      const old_locator_key = locator_key(existing_page.locator);
      const old_owner_key = owner_key(existing_page);
      const target_locator_key = locator_key(request.locator);
      const same_locator_key = key_equals(old_locator_key, target_locator_key);
      const base_entries = await this.#kv.get_many<unknown[]>([
        envelope_entry.key,
        old_locator_key,
        old_owner_key,
        ...(same_locator_key ? [] : [target_locator_key]),
      ]);
      const [current_envelope, old_locator_entry, old_owner_entry] =
        base_entries;
      if (current_envelope.versionstamp !== envelope_entry.versionstamp) {
        continue;
      }
      this.#assert_mutation_indexes(
        old_locator_entry,
        old_owner_entry,
        envelope,
      );

      let target_entry: Deno.KvEntryMaybe<unknown> | null = same_locator_key
        ? null
        : base_entries[3];
      let replaced_trial: StoredPageSnapshot | null = null;
      if (target_entry !== null && target_entry.versionstamp !== null) {
        const target_index = deserialize_locator_index(target_entry.value);
        const [current_target, target_envelope_entry] = await this.#kv.get_many<
          unknown[]
        >([target_locator_key, id_key(target_index.page_id)]);
        if (current_target.versionstamp !== target_entry.versionstamp) continue;
        if (target_envelope_entry.versionstamp === null) invariant_violation();
        const target_envelope = deserialize_envelope(
          target_envelope_entry.value,
        );
        this.#assert_snapshot_indexes(
          current_target,
          target_envelope_entry,
          target_envelope,
        );
        if (target_envelope.stewardship === "managed") {
          return { ok: false, reason: "locator_conflict" };
        }
        target_entry = current_target;
        replaced_trial = {
          entry: target_envelope_entry,
          envelope: target_envelope,
        };
      }

      const page: PageRecord = {
        ...existing_page,
        locator: structuredClone(request.locator),
        revision: envelope.revision + 1,
        updated_at: request.now,
      };
      const next_envelope = serialize_envelope(
        page,
        envelope.generation,
        envelope.chunk_count,
        envelope.data_byte_length,
      );
      const next_owner_key = owner_key(page);
      let atomic = this.#kv.native_atomic()
        .check(envelope_entry)
        .check(old_locator_entry)
        .check(old_owner_entry)
        .set(envelope_entry.key, next_envelope);
      if (same_locator_key) {
        atomic = atomic
          .set(old_locator_key, locator_index(page.page_id))
          .set(old_owner_key, owner_index(page));
      } else {
        atomic = atomic
          .check(target_entry!)
          .delete(old_locator_key)
          .delete(old_owner_key)
          .set(target_locator_key, locator_index(page.page_id))
          .set(next_owner_key, owner_index(page));
        if (replaced_trial !== null) {
          atomic = atomic
            .check(replaced_trial.entry)
            .delete(replaced_trial.entry.key);
          this.#delete_generation(atomic, replaced_trial.envelope);
        }
      }
      const commit = await atomic.commit();
      if (commit.ok) {
        return {
          ok: true,
          outcome: replaced_trial === null ? "renamed" : "replaced_trial",
          page,
        };
      }
    }
    throw new Error("page repository rename contention exhausted retries");
  }

  async duplicate_managed(
    request: DuplicateManagedRequest,
  ): Promise<DuplicateManagedResult> {
    require(
      is_valid_page_id(request.source_page_id),
      "source_page_id must be a route-safe opaque id",
    );
    require(
      is_valid_page_id(request.page_id),
      "page_id must be a route-safe opaque id",
    );
    require(
      typeof request.owner_user_id === "string" && request.owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
    require(
      is_valid_page_revision(request.expected_revision),
      "expected_revision must be a positive safe integer",
    );
    require(is_valid_time(request.now), "now must be a valid date");

    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      const source_entry = await this.#kv.get<unknown>(
        id_key(request.source_page_id),
      );
      if (source_entry.versionstamp === null) {
        return { ok: false, reason: "not_found" };
      }
      const source_envelope = deserialize_envelope(source_entry.value);
      this.#assert_envelope_identity(source_entry.key, source_envelope);
      if (
        source_envelope.stewardship !== "managed" ||
        source_envelope.owner_user_id !== request.owner_user_id
      ) {
        return { ok: false, reason: "not_found" };
      }
      require(
        request.locator.namespace.toLowerCase() ===
          source_envelope.namespace.toLowerCase(),
        "duplicate must stay within the source namespace",
      );
      if (source_envelope.revision !== request.expected_revision) {
        return { ok: false, reason: "revision_conflict" };
      }
      const source_page = await this.#read_snapshot({
        entry: source_entry,
        envelope: source_envelope,
      });
      if (source_page === null) continue;

      const target_locator_key = locator_key(request.locator);
      const source_locator_key = locator_key(source_page.locator);
      const source_owner_key = owner_key(source_page);
      const [
        current_source,
        source_locator_entry,
        source_owner_entry,
        target_entry,
        new_id_entry,
      ] = await this.#kv.get_many<unknown[]>([
        source_entry.key,
        source_locator_key,
        source_owner_key,
        target_locator_key,
        id_key(request.page_id),
      ]);
      if (current_source.versionstamp !== source_entry.versionstamp) continue;
      this.#assert_mutation_indexes(
        source_locator_entry,
        source_owner_entry,
        source_envelope,
      );

      let current_target = target_entry;
      let replaced_trial: StoredPageSnapshot | null = null;
      if (target_entry.versionstamp !== null) {
        const target_index = deserialize_locator_index(target_entry.value);
        const [checked_target, target_envelope_entry] = await this.#kv.get_many<
          unknown[]
        >([target_locator_key, id_key(target_index.page_id)]);
        if (checked_target.versionstamp !== target_entry.versionstamp) continue;
        if (target_envelope_entry.versionstamp === null) invariant_violation();
        const target_envelope = deserialize_envelope(
          target_envelope_entry.value,
        );
        this.#assert_snapshot_indexes(
          checked_target,
          target_envelope_entry,
          target_envelope,
        );
        if (target_envelope.stewardship === "managed") {
          return { ok: false, reason: "locator_conflict" };
        }
        current_target = checked_target;
        replaced_trial = {
          entry: target_envelope_entry,
          envelope: target_envelope,
        };
      }
      if (new_id_entry.versionstamp !== null) {
        return { ok: false, reason: "page_id_conflict" };
      }

      const page: PageRecord = {
        page_id: request.page_id,
        locator: structuredClone(request.locator),
        stewardship: structuredClone(source_page.stewardship),
        access: source_page.access,
        tags: structuredClone(source_page.tags),
        revision: 1,
        content: structuredClone(source_page.content),
        created_at: request.now,
        updated_at: request.now,
      };
      const serialized = serialize_data(page.content);
      const chunks = split_chunks(serialized);
      const generation = crypto.randomUUID();
      const envelope = serialize_envelope(
        page,
        generation,
        chunks.length,
        serialized.length,
      );
      await this.#write_chunks(page.page_id, generation, chunks);
      let atomic = this.#kv.native_atomic()
        .check(source_entry)
        .check(source_locator_entry)
        .check(source_owner_entry)
        .check(current_target)
        .check(new_id_entry)
        .set(id_key(page.page_id), envelope)
        .set(target_locator_key, locator_index(page.page_id))
        .set(owner_key(page), owner_index(page));
      if (replaced_trial !== null) {
        atomic = atomic
          .check(replaced_trial.entry)
          .delete(replaced_trial.entry.key);
        this.#delete_generation(atomic, replaced_trial.envelope);
      }
      const commit = await atomic.commit();
      if (commit.ok) {
        return {
          ok: true,
          outcome: replaced_trial === null ? "created" : "replaced_trial",
          page,
        };
      }
      await this.#cleanup_generation(page.page_id, generation, chunks.length);
    }
    throw new Error("page repository duplicate contention exhausted retries");
  }

  async delete_managed(
    request: DeleteManagedRequest,
  ): Promise<DeleteManagedResult> {
    require(
      is_valid_page_id(request.page_id),
      "page_id must be a route-safe opaque id",
    );
    require(
      typeof request.owner_user_id === "string" && request.owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
    require(
      is_valid_page_revision(request.expected_revision),
      "expected_revision must be a positive safe integer",
    );
    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      const envelope_entry = await this.#kv.get<unknown>(
        id_key(request.page_id),
      );
      if (envelope_entry.versionstamp === null) {
        return { ok: false, reason: "not_found" };
      }
      const envelope = deserialize_envelope(envelope_entry.value);
      this.#assert_envelope_identity(envelope_entry.key, envelope);
      if (
        envelope.stewardship !== "managed" ||
        envelope.owner_user_id !== request.owner_user_id
      ) {
        return { ok: false, reason: "not_found" };
      }
      if (envelope.revision !== request.expected_revision) {
        return { ok: false, reason: "revision_conflict" };
      }
      const page = envelope_page(envelope, null);
      const [current_envelope, locator_entry, owner_entry] = await this.#kv
        .get_many<unknown[]>([
          envelope_entry.key,
          locator_key(envelope_locator(envelope)),
          owner_key(page),
        ]);
      if (current_envelope.versionstamp !== envelope_entry.versionstamp) {
        continue;
      }
      this.#assert_mutation_indexes(locator_entry, owner_entry, envelope);
      const atomic = this.#kv.native_atomic()
        .check(envelope_entry)
        .check(locator_entry)
        .check(owner_entry)
        .delete(envelope_entry.key)
        .delete(locator_entry.key)
        .delete(owner_entry.key);
      this.#delete_generation(atomic, envelope);
      const commit = await atomic.commit();
      if (commit.ok) return { ok: true };
    }
    throw new Error("page repository delete contention exhausted retries");
  }

  #assert_envelope_identity(
    key: Deno.KvKey,
    envelope: StoredPageEnvelope,
  ): void {
    if (!key_equals(key, id_key(envelope.page_id))) invariant_violation();
  }

  #assert_snapshot_indexes(
    locator_entry: Deno.KvEntry<unknown>,
    envelope_entry: Deno.KvEntry<unknown>,
    envelope: StoredPageEnvelope,
  ): void {
    this.#assert_envelope_identity(envelope_entry.key, envelope);
    const index = deserialize_locator_index(locator_entry.value);
    if (
      index.page_id !== envelope.page_id ||
      !key_equals(locator_entry.key, locator_key(envelope_locator(envelope)))
    ) {
      invariant_violation();
    }
  }

  #assert_mutation_indexes(
    locator_entry: Deno.KvEntryMaybe<unknown>,
    owner_entry: Deno.KvEntryMaybe<unknown>,
    envelope: StoredPageEnvelope,
  ): void {
    if (
      locator_entry.versionstamp === null || owner_entry.versionstamp === null
    ) {
      invariant_violation();
    }
    const locator = deserialize_locator_index(locator_entry.value);
    const owner = deserialize_owner_index(owner_entry.value);
    if (
      locator.page_id !== envelope.page_id ||
      owner.page_id !== envelope.page_id ||
      owner.revision !== envelope.revision
    ) {
      invariant_violation();
    }
  }

  async #read_snapshot(
    snapshot: StoredPageSnapshot,
  ): Promise<PageRecord | null> {
    const bytes = await this.#read_generation(snapshot.envelope);
    if (bytes !== null) {
      return envelope_page(snapshot.envelope, deserialize_data(bytes));
    }
    const current = await this.#kv.get<unknown>(snapshot.entry.key);
    if (current.versionstamp === snapshot.entry.versionstamp) {
      return invalid_stored_page();
    }
    return null;
  }

  async #read_generation(
    envelope: StoredPageEnvelope,
  ): Promise<Uint8Array | null> {
    const chunks: Uint8Array[] = [];
    let total_length = 0;
    for await (
      const entry of this.#kv.list<unknown>({
        prefix: generation_prefix(envelope.page_id, envelope.generation),
      })
    ) {
      const index = entry.key[entry.key.length - 1];
      if (
        entry.key.length !== chunk_prefix.length + 3 ||
        index !== chunks.length || !(entry.value instanceof Uint8Array) ||
        entry.value.length === 0 ||
        entry.value.length > page_content_chunk_byte_length
      ) {
        return null;
      }
      chunks.push(entry.value);
      total_length += entry.value.length;
    }
    if (
      chunks.length !== envelope.chunk_count ||
      total_length !== envelope.data_byte_length
    ) {
      return null;
    }
    const bytes = new Uint8Array(total_length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  async #write_chunks(
    page_id: string,
    generation: string,
    chunks: readonly Uint8Array[],
  ): Promise<void> {
    for (
      let start = 0;
      start < chunks.length;
      start += chunk_write_batch_size
    ) {
      const atomic = this.#kv.native_atomic();
      chunks.slice(start, start + chunk_write_batch_size).forEach(
        (chunk, offset) =>
          atomic.set(chunk_key(page_id, generation, start + offset), chunk),
      );
      const commit = await atomic.commit();
      if (!commit.ok) {
        await this.#cleanup_generation(page_id, generation, chunks.length);
        throw new Error("page repository chunk write failed");
      }
    }
  }

  #delete_generation(
    atomic: Deno.AtomicOperation,
    envelope: StoredPageEnvelope,
  ): void {
    for (let index = 0; index < envelope.chunk_count; index += 1) {
      atomic.delete(chunk_key(envelope.page_id, envelope.generation, index));
    }
  }

  async #cleanup_generation(
    page_id: string,
    generation: string,
    chunk_count: number,
  ): Promise<void> {
    try {
      for (
        let start = 0;
        start < chunk_count;
        start += chunk_write_batch_size
      ) {
        const atomic = this.#kv.native_atomic();
        for (
          let index = start;
          index < Math.min(start + chunk_write_batch_size, chunk_count);
          index += 1
        ) {
          atomic.delete(chunk_key(page_id, generation, index));
        }
        await atomic.commit();
      }
    } catch {
      // A failed condition may leave only unreferenced chunks. Cleanup is
      // deliberately best effort; no index or envelope can expose them.
    }
  }
}
