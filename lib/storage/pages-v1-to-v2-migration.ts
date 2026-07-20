import type { ContentAsset } from "../content/asset.ts";
import {
  DenoKvPageRepository,
  page_v1_by_id_prefix,
  page_v1_by_locator_prefix,
  page_v1_by_owner_prefix,
  page_v1_locator_key,
  page_v1_owner_key,
} from "../page/kv-repository.ts";
import type { PageAggregate } from "../page/aggregate.ts";
import {
  is_valid_page_id,
  page_record_violation,
  type PageRecord,
} from "../page/model.ts";
import {
  content_data_encoding_v8_1,
  V8ContentDataCodec,
} from "./content-data-codec.ts";
import type { KvGateway } from "./kv-gateway.ts";
import {
  KvContentAssetRepository,
  type StoredContentAssetManifest,
} from "./kv-content-asset-repository.ts";
import { KvPageAggregateRepository } from "./kv-page-aggregate-repository.ts";

export const pages_v1_to_v2_migration_id = "pages-v1-to-v2" as const;
export const pages_v1_to_v2_readiness_key: Deno.KvKey = [
  "iam-pager",
  "page-aggregates",
  "v2",
  "migration",
  pages_v1_to_v2_migration_id,
];

const readiness_schema_version = 2;
const max_publication_attempts = 16;
const encoder = new TextEncoder();

export interface StoredPagesV1ToV2Readiness {
  readonly schema_version: 2;
  readonly migration_id: typeof pages_v1_to_v2_migration_id;
  readonly source_page_count: number;
  readonly source_fingerprint: string;
}

export interface PagesV1ToV2MigrationSource {
  read_pages(): Promise<readonly PageRecord[]>;
}

export interface MappedPagesV1ToV2Page {
  readonly asset: ContentAsset;
  readonly aggregate: PageAggregate;
  readonly payload_id: string;
  readonly payload_bytes: Uint8Array;
  readonly payload_sha256: string;
}

export interface PagesV1ToV2MigrationTarget {
  import_content_asset(page: MappedPagesV1ToV2Page): Promise<void>;
  import_page_aggregate(page: MappedPagesV1ToV2Page): Promise<void>;
  verify_page(page: MappedPagesV1ToV2Page): Promise<void>;
  read_readiness(): Promise<StoredPagesV1ToV2Readiness | null>;
  publish_readiness(readiness: StoredPagesV1ToV2Readiness): Promise<void>;
}

export interface PageAggregateReadinessProbe {
  assert_ready(): Promise<void>;
}

interface ProjectedPagesV1Source {
  readonly pages: readonly MappedPagesV1ToV2Page[];
  readonly readiness: StoredPagesV1ToV2Readiness;
}

function source_corruption(reason: string): never {
  throw new Error(
    `${pages_v1_to_v2_migration_id}: invalid schema-v1 source: ${reason}`,
  );
}

function destination_conflict(reason: string): never {
  throw new Error(
    `${pages_v1_to_v2_migration_id}: destination conflict: ${reason}`,
  );
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

function key_part_equals(
  left: Deno.KvKeyPart,
  right: Deno.KvKeyPart,
): boolean {
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return bytes_equal(left, right);
  }
  return left === right;
}

function key_equals(left: Deno.KvKey, right: Deno.KvKey): boolean {
  return left.length === right.length &&
    left.every((part, index) => key_part_equals(part, right[index]));
}

function key_token(key: Deno.KvKey): string {
  return JSON.stringify(
    key.map((part) =>
      part instanceof Uint8Array
        ? { bytes: Array.from(part) }
        : { type: typeof part, value: part }
    ),
  );
}

function bytes_equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);
}

function scalar_record_equals(
  supplied: unknown,
  expected: Readonly<Record<string, string | number>>,
): boolean {
  if (
    typeof supplied !== "object" || supplied === null ||
    Array.isArray(supplied)
  ) {
    return false;
  }
  const record = supplied as Record<string, unknown>;
  const keys = Object.keys(expected);
  return has_exact_keys(record, keys) &&
    keys.every((key) => record[key] === expected[key]);
}

function readiness_equals(
  left: StoredPagesV1ToV2Readiness,
  right: StoredPagesV1ToV2Readiness,
): boolean {
  return left.schema_version === right.schema_version &&
    left.migration_id === right.migration_id &&
    left.source_page_count === right.source_page_count &&
    left.source_fingerprint === right.source_fingerprint;
}

function manifests_equal(
  left: StoredContentAssetManifest,
  right: StoredContentAssetManifest,
): boolean {
  return left.schema_version === right.schema_version &&
    left.data_encoding === right.data_encoding &&
    left.content_asset_id === right.content_asset_id &&
    left.payload_id === right.payload_id &&
    left.payload_byte_length === right.payload_byte_length &&
    left.payload_sha256 === right.payload_sha256 &&
    left.content_type === right.content_type &&
    left.media_type === right.media_type &&
    left.size_bytes === right.size_bytes &&
    left.download_filename === right.download_filename &&
    left.created_at === right.created_at;
}

async function digest(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice()));
}

function digest_hex(bytes: Uint8Array): string {
  return Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function digest_base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function deterministic_id(
  prefix: "v1a_" | "v1p_",
  descriptor: Readonly<Record<string, unknown>>,
): Promise<string> {
  return `${prefix}${
    digest_base64url(
      await digest(
        encoder.encode(JSON.stringify(descriptor)),
      ),
    )
  }`;
}

function readiness_record(value: unknown): StoredPagesV1ToV2Readiness {
  if (
    typeof value !== "object" || value === null || Array.isArray(value)
  ) {
    return destination_conflict("invalid readiness record");
  }
  const stored = value as Record<string, unknown>;
  if (
    !has_exact_keys(stored, [
      "schema_version",
      "migration_id",
      "source_page_count",
      "source_fingerprint",
    ]) ||
    stored.schema_version !== readiness_schema_version ||
    stored.migration_id !== pages_v1_to_v2_migration_id ||
    !Number.isSafeInteger(stored.source_page_count) ||
    (stored.source_page_count as number) < 0 ||
    typeof stored.source_fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(stored.source_fingerprint)
  ) {
    return destination_conflict("invalid readiness record");
  }
  return stored as unknown as StoredPagesV1ToV2Readiness;
}

/**
 * Strictly replays the selected schema-v1 repository's read invariants and then
 * proves there are no missing or orphan locator/owner visibility indexes.
 * Unreferenced chunk generations remain tolerated: schema-v1 staging documents
 * them as invisible best-effort-cleanup residue.
 */
export class KvPagesV1ToV2MigrationSource
  implements PagesV1ToV2MigrationSource {
  readonly #kv: KvGateway;
  readonly #repository: DenoKvPageRepository;

  constructor(kv: KvGateway) {
    this.#kv = kv;
    this.#repository = new DenoKvPageRepository(kv);
  }

  async read_pages(): Promise<readonly PageRecord[]> {
    const pages: PageRecord[] = [];
    const page_ids = new Set<string>();
    for await (
      const entry of this.#kv.list<unknown>({ prefix: page_v1_by_id_prefix })
    ) {
      if (
        entry.key.length !== page_v1_by_id_prefix.length + 1 ||
        typeof entry.key[entry.key.length - 1] !== "string" ||
        !is_valid_page_id(entry.key[entry.key.length - 1])
      ) {
        return source_corruption("malformed by-id key");
      }
      const page_id = entry.key[entry.key.length - 1] as string;
      if (page_ids.has(page_id)) {
        return source_corruption("duplicate page identity");
      }
      const page = await this.#repository.find_by_id(page_id);
      if (page === null) {
        return source_corruption(`page ${page_id} disappeared while reading`);
      }
      page_ids.add(page_id);
      pages.push(page);
    }
    pages.sort((left, right) => left.page_id.localeCompare(right.page_id));

    const locator_indexes = new Map<
      string,
      Readonly<Record<string, string | number>>
    >();
    const owner_indexes = new Map<
      string,
      Readonly<Record<string, string | number>>
    >();
    for (const page of pages) {
      const locator_token = key_token(page_v1_locator_key(page.locator));
      if (locator_indexes.has(locator_token)) {
        return source_corruption("multiple pages claim one locator");
      }
      locator_indexes.set(locator_token, {
        schema_version: 1,
        page_id: page.page_id,
      });
      if (page.stewardship.kind === "managed") {
        const owner_token = key_token(page_v1_owner_key(page));
        if (owner_indexes.has(owner_token)) {
          return source_corruption("multiple pages claim one owner index");
        }
        owner_indexes.set(owner_token, {
          schema_version: 1,
          page_id: page.page_id,
          revision: page.revision,
        });
      }
    }
    await this.#validate_indexes(
      page_v1_by_locator_prefix,
      locator_indexes,
      "locator",
    );
    await this.#validate_indexes(
      page_v1_by_owner_prefix,
      owner_indexes,
      "owner",
    );
    return pages.map((page) => structuredClone(page));
  }

  async #validate_indexes(
    prefix: Deno.KvKey,
    expected: ReadonlyMap<
      string,
      Readonly<Record<string, string | number>>
    >,
    label: string,
  ): Promise<void> {
    const seen = new Set<string>();
    for await (const entry of this.#kv.list<unknown>({ prefix })) {
      const token = key_token(entry.key);
      const expected_value = expected.get(token);
      if (
        expected_value === undefined || seen.has(token) ||
        !scalar_record_equals(entry.value, expected_value)
      ) {
        return source_corruption(`unexpected or malformed ${label} index`);
      }
      seen.add(token);
    }
    if (seen.size !== expected.size) {
      return source_corruption(`missing ${label} index`);
    }
  }
}

export async function map_page_v1_to_v2(
  supplied_page: PageRecord,
): Promise<MappedPagesV1ToV2Page> {
  const page = structuredClone(supplied_page);
  const violation = page_record_violation(page);
  if (violation !== null) return source_corruption(violation);
  const codec = new V8ContentDataCodec();
  const payload_bytes = codec.encode(page.content.data);
  const payload_digest = await digest(payload_bytes);
  const payload_sha256 = digest_hex(payload_digest);
  const identity = {
    migration_id: pages_v1_to_v2_migration_id,
    page_id: page.page_id,
    revision: page.revision,
    payload_sha256,
    content_type: page.content.content_type,
    media_type: page.content.meta.media_type,
    size_bytes: page.content.meta.size_bytes,
    download_filename: page.content.meta.download_filename ?? null,
    created_at: page.created_at.toISOString(),
  };
  const content_asset_id = await deterministic_id("v1a_", identity);
  const payload_id = await deterministic_id("v1p_", {
    migration_id: pages_v1_to_v2_migration_id,
    page_id: page.page_id,
    revision: page.revision,
    payload_sha256,
  });
  return {
    asset: {
      content_asset_id,
      content_type: page.content.content_type,
      data: structuredClone(page.content.data),
      meta: structuredClone(page.content.meta),
      created_at: new Date(page.created_at),
    },
    aggregate: {
      page_id: page.page_id,
      endpoint_set: {
        canonical: {
          locator: structuredClone(page.locator),
          delivery_profile: "inline",
        },
        alternates: [],
      },
      stewardship: structuredClone(page.stewardship),
      access: page.access,
      tags: [...page.tags],
      revision: page.revision,
      content_asset_id,
      created_at: new Date(page.created_at),
      updated_at: new Date(page.updated_at),
    },
    payload_id,
    payload_bytes: payload_bytes.slice(),
    payload_sha256,
  };
}

async function project_source(
  source: PagesV1ToV2MigrationSource,
): Promise<ProjectedPagesV1Source> {
  const records = [...await source.read_pages()];
  records.sort((left, right) => left.page_id.localeCompare(right.page_id));
  const pages: MappedPagesV1ToV2Page[] = [];
  for (const record of records) pages.push(await map_page_v1_to_v2(record));
  const fingerprint_input = pages.map((page) => ({
    page_id: page.aggregate.page_id,
    canonical: page.aggregate.endpoint_set.canonical,
    stewardship: page.aggregate.stewardship,
    access: page.aggregate.access,
    tags: page.aggregate.tags,
    revision: page.aggregate.revision,
    content_asset_id: page.aggregate.content_asset_id,
    created_at: page.aggregate.created_at.toISOString(),
    updated_at: page.aggregate.updated_at.toISOString(),
    payload_id: page.payload_id,
    payload_sha256: page.payload_sha256,
  }));
  const source_fingerprint = digest_hex(
    await digest(encoder.encode(JSON.stringify(fingerprint_input))),
  );
  return {
    pages,
    readiness: {
      schema_version: readiness_schema_version,
      migration_id: pages_v1_to_v2_migration_id,
      source_page_count: pages.length,
      source_fingerprint,
    },
  };
}

class FixedPayloadIdGenerator {
  readonly #payload_id: string;

  constructor(payload_id: string) {
    this.#payload_id = payload_id;
  }

  generate(): string {
    return this.#payload_id;
  }
}

export class KvPagesV1ToV2MigrationTarget
  implements PagesV1ToV2MigrationTarget {
  readonly #kv: KvGateway;
  readonly #pages: KvPageAggregateRepository;

  constructor(kv: KvGateway) {
    this.#kv = kv;
    this.#pages = new KvPageAggregateRepository(kv);
  }

  async import_content_asset(page: MappedPagesV1ToV2Page): Promise<void> {
    const repository = this.#asset_repository(page.payload_id);
    try {
      await repository.create_content_asset(page.asset);
    } catch (error) {
      try {
        await this.verify_content_asset(page);
        return;
      } catch {
        throw error;
      }
    }
    await this.verify_content_asset(page);
  }

  async import_page_aggregate(page: MappedPagesV1ToV2Page): Promise<void> {
    await this.#pages.import_page_aggregate(page.aggregate);
    await this.#pages.verify_imported_page_aggregate(page.aggregate);
  }

  async verify_page(page: MappedPagesV1ToV2Page): Promise<void> {
    await this.verify_content_asset(page);
    await this.#pages.verify_imported_page_aggregate(page.aggregate);
  }

  async verify_content_asset(page: MappedPagesV1ToV2Page): Promise<void> {
    const repository = this.#asset_repository(page.payload_id);
    const manifest_entry = await repository.find_content_asset_manifest_entry(
      page.asset.content_asset_id,
    );
    if (manifest_entry === null) {
      return destination_conflict(
        `asset ${page.asset.content_asset_id} manifest is absent`,
      );
    }
    const expected_manifest: StoredContentAssetManifest = {
      schema_version: 1,
      data_encoding: content_data_encoding_v8_1,
      content_asset_id: page.asset.content_asset_id,
      payload_id: page.payload_id,
      payload_byte_length: page.payload_bytes.byteLength,
      payload_sha256: page.payload_sha256,
      content_type: page.asset.content_type,
      media_type: page.asset.meta.media_type,
      size_bytes: page.asset.meta.size_bytes,
      ...(page.asset.meta.download_filename === undefined
        ? {}
        : { download_filename: page.asset.meta.download_filename }),
      created_at: page.asset.created_at.toISOString(),
    };
    if (!manifests_equal(manifest_entry.value, expected_manifest)) {
      return destination_conflict(
        `asset ${page.asset.content_asset_id} manifest differs`,
      );
    }
    const stored_asset = await repository.find_content_asset_by_id(
      page.asset.content_asset_id,
    );
    if (
      stored_asset === null ||
      stored_asset.content_type !== page.asset.content_type ||
      stored_asset.meta.media_type !== page.asset.meta.media_type ||
      stored_asset.meta.size_bytes !== page.asset.meta.size_bytes ||
      stored_asset.meta.download_filename !==
        page.asset.meta.download_filename ||
      stored_asset.created_at.toISOString() !==
        page.asset.created_at.toISOString() ||
      !bytes_equal(
        new V8ContentDataCodec().encode(stored_asset.data),
        page.payload_bytes,
      )
    ) {
      return destination_conflict(
        `asset ${page.asset.content_asset_id} content differs`,
      );
    }
  }

  async read_readiness(): Promise<StoredPagesV1ToV2Readiness | null> {
    const entry = await this.#kv.get<unknown>(pages_v1_to_v2_readiness_key);
    if (entry.versionstamp === null) return null;
    if (!key_equals(entry.key, pages_v1_to_v2_readiness_key)) {
      return destination_conflict("readiness key identity differs");
    }
    return readiness_record(entry.value);
  }

  async publish_readiness(
    readiness: StoredPagesV1ToV2Readiness,
  ): Promise<void> {
    const expected = readiness_record(readiness);
    for (let attempt = 0; attempt < max_publication_attempts; attempt += 1) {
      const entry = await this.#kv.get<unknown>(pages_v1_to_v2_readiness_key);
      if (entry.versionstamp !== null) {
        const existing = readiness_record(entry.value);
        if (!readiness_equals(existing, expected)) {
          return destination_conflict("readiness source fingerprint differs");
        }
        return;
      }
      const result = await this.#kv.native_atomic()
        .check(entry)
        .set(pages_v1_to_v2_readiness_key, expected)
        .commit();
      if (result.ok) return;
    }
    throw new Error(
      `${pages_v1_to_v2_migration_id}: readiness publication contention exhausted retries`,
    );
  }

  #asset_repository(payload_id: string): KvContentAssetRepository {
    return new KvContentAssetRepository(this.#kv, {
      payload_id_generator: new FixedPayloadIdGenerator(payload_id),
      payload_staging_mode: "reuse-identical",
    });
  }
}

/** Manual adjacent migration. It never writes or deletes a schema-v1 key. */
export class PagesV1ToV2Migration {
  readonly #source: PagesV1ToV2MigrationSource;
  readonly #target: PagesV1ToV2MigrationTarget;

  constructor(
    source: PagesV1ToV2MigrationSource,
    target: PagesV1ToV2MigrationTarget,
  ) {
    this.#source = source;
    this.#target = target;
  }

  async migrate(): Promise<void> {
    const initial = await project_source(this.#source);
    for (const page of initial.pages) {
      await this.#target.import_content_asset(page);
      await this.#target.import_page_aggregate(page);
    }

    const final = await project_source(this.#source);
    if (!readiness_equals(initial.readiness, final.readiness)) {
      throw new Error(
        `${pages_v1_to_v2_migration_id}: schema-v1 source changed while migration was running`,
      );
    }
    for (const page of final.pages) await this.#target.verify_page(page);
    const verified = await project_source(this.#source);
    if (!readiness_equals(final.readiness, verified.readiness)) {
      throw new Error(
        `${pages_v1_to_v2_migration_id}: schema-v1 source changed during verification`,
      );
    }
    await this.#target.publish_readiness(verified.readiness);
    const stored_readiness = await this.#target.read_readiness();
    if (
      stored_readiness === null ||
      !readiness_equals(stored_readiness, verified.readiness)
    ) {
      throw new Error(
        `${pages_v1_to_v2_migration_id}: readiness verification failed`,
      );
    }

    const published = await project_source(this.#source);
    if (!readiness_equals(stored_readiness, published.readiness)) {
      throw new Error(
        `${pages_v1_to_v2_migration_id}: schema-v1 source changed after readiness publication`,
      );
    }
    for (const page of published.pages) await this.#target.verify_page(page);
    const ready = await project_source(this.#source);
    if (!readiness_equals(published.readiness, ready.readiness)) {
      throw new Error(
        `${pages_v1_to_v2_migration_id}: schema-v1 source changed during final readiness verification`,
      );
    }
  }
}

export class KvPagesV2ReadinessProbe implements PageAggregateReadinessProbe {
  readonly #source: PagesV1ToV2MigrationSource;
  readonly #target: PagesV1ToV2MigrationTarget;

  constructor(kv: KvGateway) {
    this.#source = new KvPagesV1ToV2MigrationSource(kv);
    this.#target = new KvPagesV1ToV2MigrationTarget(kv);
  }

  async assert_ready(): Promise<void> {
    let projected: ProjectedPagesV1Source;
    try {
      projected = await project_source(this.#source);
    } catch (error) {
      throw new Error(
        "page aggregate readiness refused: schema-v1 storage is invalid",
        { cause: error },
      );
    }

    let readiness: StoredPagesV1ToV2Readiness | null;
    try {
      readiness = await this.#target.read_readiness();
    } catch (error) {
      throw new Error(
        "page aggregate readiness refused: migration readiness record is invalid",
        { cause: error },
      );
    }
    if (readiness === null) {
      throw new Error(
        projected.pages.length === 0
          ? "page aggregate readiness refused: pages-v1-to-v2 migration has not been verified"
          : "page aggregate readiness refused: non-empty schema-v1 storage is unmigrated",
      );
    }
    if (!readiness_equals(readiness, projected.readiness)) {
      throw new Error(
        "page aggregate readiness refused: schema-v1 storage changed after migration",
      );
    }
    try {
      for (const page of projected.pages) {
        await this.#target.verify_page(page);
      }
    } catch (error) {
      throw new Error(
        "page aggregate readiness refused: migrated v2 storage is incomplete or conflicting",
        { cause: error },
      );
    }
    const verified = await project_source(this.#source);
    if (!readiness_equals(projected.readiness, verified.readiness)) {
      throw new Error(
        "page aggregate readiness refused: schema-v1 storage changed during verification",
      );
    }
  }
}

export async function migrate_pages_v1_to_v2(kv: KvGateway): Promise<void> {
  await new PagesV1ToV2Migration(
    new KvPagesV1ToV2MigrationSource(kv),
    new KvPagesV1ToV2MigrationTarget(kv),
  ).migrate();
}
