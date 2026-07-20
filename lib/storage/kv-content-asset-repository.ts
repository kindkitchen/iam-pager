import {
  content_asset_violation,
  type ContentAsset,
  type ContentAssetId,
  is_valid_content_asset_id,
} from "../content/asset.ts";
import type {
  ContentAssetCreator,
  ContentAssetReader,
  CreateContentAssetResult,
} from "../content/interfaces.ts";
import {
  type ContentDataCodec,
  V8ContentDataCodec,
} from "./content-data-codec.ts";
import type { KvGateway } from "./kv-gateway.ts";

const storage_schema_version = 1;

export const content_asset_manifest_prefix: Deno.KvKey = [
  "iam-pager",
  "content-assets",
  "v1",
  "by-id",
];
export const content_asset_payload_prefix: Deno.KvKey = [
  "iam-pager",
  "content-assets",
  "v1",
  "payloads",
];

/** Adapter-owned record published only after its encoded payload is verified. */
export interface StoredContentAssetManifest {
  readonly schema_version: 1;
  readonly data_encoding: string;
  readonly content_asset_id: string;
  readonly payload_id: string;
  readonly payload_byte_length: number;
  readonly payload_sha256: string;
  readonly content_type: string;
  readonly media_type: string;
  readonly size_bytes: number;
  readonly download_filename?: string;
  readonly created_at: string;
}

/** Storage-local manifest snapshot used by atomic page publication. */
export interface ContentAssetManifestEntryReader {
  find_content_asset_manifest_entry(
    content_asset_id: ContentAssetId,
  ): Promise<Deno.KvEntry<StoredContentAssetManifest> | null>;
}

/** Storage-local source of random, unreachable payload identities. */
export interface ContentAssetPayloadIdGenerator {
  generate(): string;
}

export class CryptoContentAssetPayloadIdGenerator
  implements ContentAssetPayloadIdGenerator {
  generate(): string {
    return crypto.randomUUID();
  }
}

export type ContentAssetPayloadStagingMode =
  | "new"
  | "reuse-identical";

export interface KvContentAssetRepositoryOptions {
  readonly codec?: ContentDataCodec;
  readonly payload_id_generator?: ContentAssetPayloadIdGenerator;
  /** Migration-only mode for a deterministic payload key retained across retries. */
  readonly payload_staging_mode?: ContentAssetPayloadStagingMode;
}

export function content_asset_manifest_key(
  content_asset_id: ContentAssetId,
): Deno.KvKey {
  return [...content_asset_manifest_prefix, content_asset_id];
}

export function content_asset_payload_key(payload_id: string): Deno.KvKey {
  return [...content_asset_payload_prefix, payload_id];
}

function require(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`content asset repository: ${message}`);
}

function invalid_stored_content_asset(): never {
  throw new TypeError("invalid stored content asset");
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

function deserialize_date(value: unknown): Date {
  if (typeof value !== "string") return invalid_stored_content_asset();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    return invalid_stored_content_asset();
  }
  return date;
}

function key_part_equals(a: Deno.KvKeyPart, b: Deno.KvKeyPart): boolean {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  }
  return a === b;
}

function key_equals(a: Deno.KvKey, b: Deno.KvKey): boolean {
  return a.length === b.length &&
    a.every((part, index) => key_part_equals(part, b[index]));
}

function bytes_equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);
}

function deserialize_manifest(
  expected_content_asset_id: ContentAssetId,
  expected_data_encoding: string,
  entry: Deno.KvEntry<unknown>,
): StoredContentAssetManifest {
  if (
    !key_equals(
      entry.key,
      content_asset_manifest_key(expected_content_asset_id),
    ) ||
    typeof entry.value !== "object" || entry.value === null ||
    Array.isArray(entry.value)
  ) {
    return invalid_stored_content_asset();
  }
  const stored = entry.value as Record<string, unknown>;
  const has_download_filename = Object.hasOwn(
    stored,
    "download_filename",
  );
  if (
    !has_exact_keys(stored, [
      "schema_version",
      "data_encoding",
      "content_asset_id",
      "payload_id",
      "payload_byte_length",
      "payload_sha256",
      "content_type",
      "media_type",
      "size_bytes",
      "created_at",
    ], ["download_filename"]) ||
    stored.schema_version !== storage_schema_version ||
    stored.data_encoding !== expected_data_encoding ||
    stored.content_asset_id !== expected_content_asset_id ||
    !is_valid_content_asset_id(stored.content_asset_id) ||
    !is_valid_content_asset_id(stored.payload_id) ||
    !Number.isSafeInteger(stored.payload_byte_length) ||
    (stored.payload_byte_length as number) < 1 ||
    typeof stored.payload_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(stored.payload_sha256) ||
    typeof stored.content_type !== "string" || stored.content_type === "" ||
    typeof stored.media_type !== "string" || stored.media_type === "" ||
    !Number.isSafeInteger(stored.size_bytes) ||
    (stored.size_bytes as number) < 0 ||
    (has_download_filename &&
      typeof stored.download_filename !== "string")
  ) {
    return invalid_stored_content_asset();
  }
  deserialize_date(stored.created_at);
  return stored as unknown as StoredContentAssetManifest;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function manifest_asset(
  manifest: StoredContentAssetManifest,
  data: unknown,
): ContentAsset {
  const asset: ContentAsset = {
    content_asset_id: manifest.content_asset_id,
    content_type: manifest.content_type,
    data,
    meta: {
      media_type: manifest.media_type,
      size_bytes: manifest.size_bytes,
      ...(manifest.download_filename === undefined
        ? {}
        : { download_filename: manifest.download_filename }),
    },
    created_at: deserialize_date(manifest.created_at),
  };
  if (content_asset_violation(asset) !== null) {
    return invalid_stored_content_asset();
  }
  return asset;
}

/**
 * Immutable gateway-backed content-asset adapter. Payload bytes remain
 * unreachable until one strict manifest is published with native Deno KV CAS.
 */
export class KvContentAssetRepository
  implements
    ContentAssetCreator,
    ContentAssetReader,
    ContentAssetManifestEntryReader {
  readonly #kv: KvGateway;
  readonly #codec: ContentDataCodec;
  readonly #payload_id_generator: ContentAssetPayloadIdGenerator;
  readonly #payload_staging_mode: ContentAssetPayloadStagingMode;

  constructor(
    kv: KvGateway,
    options: KvContentAssetRepositoryOptions = {},
  ) {
    this.#kv = kv;
    this.#codec = options.codec ?? new V8ContentDataCodec();
    this.#payload_id_generator = options.payload_id_generator ??
      new CryptoContentAssetPayloadIdGenerator();
    this.#payload_staging_mode = options.payload_staging_mode ?? "new";
    require(
      typeof this.#codec.encoding_version === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(this.#codec.encoding_version),
      "codec encoding_version must be a storage-safe identifier",
    );
    require(
      this.#payload_staging_mode === "new" ||
        this.#payload_staging_mode === "reuse-identical",
      "payload_staging_mode must be new or reuse-identical",
    );
  }

  async find_content_asset_manifest_entry(
    content_asset_id: ContentAssetId,
  ): Promise<Deno.KvEntry<StoredContentAssetManifest> | null> {
    require(
      is_valid_content_asset_id(content_asset_id),
      "content_asset_id must be a route-safe opaque id",
    );
    const entry = await this.#kv.get<unknown>(
      content_asset_manifest_key(content_asset_id),
    );
    if (entry.versionstamp === null) return null;
    return {
      key: entry.key,
      value: deserialize_manifest(
        content_asset_id,
        this.#codec.encoding_version,
        entry,
      ),
      versionstamp: entry.versionstamp,
    };
  }

  async create_content_asset(
    asset: ContentAsset,
  ): Promise<CreateContentAssetResult> {
    const violation = content_asset_violation(asset);
    require(violation === null, violation ?? "invalid content asset");

    // Snapshot every caller-owned value before the first asynchronous boundary.
    const content_asset_id = asset.content_asset_id;
    const content_type = asset.content_type;
    const media_type = asset.meta.media_type;
    const size_bytes = asset.meta.size_bytes;
    const download_filename = asset.meta.download_filename;
    const created_at = asset.created_at.toISOString();
    const encoded = this.#codec.encode(asset.data);
    if (!(encoded instanceof Uint8Array) || encoded.byteLength === 0) {
      throw new TypeError(
        "content asset repository: codec must produce non-empty bytes",
      );
    }
    const payload_bytes = encoded.slice();

    const manifest_storage_key = content_asset_manifest_key(content_asset_id);
    const existing = await this.#kv.get<unknown>(manifest_storage_key);
    if (existing.versionstamp !== null) {
      deserialize_manifest(
        content_asset_id,
        this.#codec.encoding_version,
        existing,
      );
      return { ok: false, reason: "content_asset_id_conflict" };
    }

    const payload_sha256 = await sha256(payload_bytes);
    const payload_id = this.#payload_id_generator.generate();
    require(
      is_valid_content_asset_id(payload_id),
      "payload id generator produced an invalid id",
    );
    const payload_storage_key = content_asset_payload_key(payload_id);

    let cleanup_on_failure = false;
    let retain_payload = this.#payload_staging_mode === "reuse-identical";
    try {
      cleanup_on_failure = await this.#stage_payload(
        payload_storage_key,
        payload_bytes,
      );

      const manifest: StoredContentAssetManifest = {
        schema_version: storage_schema_version,
        data_encoding: this.#codec.encoding_version,
        content_asset_id,
        payload_id,
        payload_byte_length: payload_bytes.byteLength,
        payload_sha256,
        content_type,
        media_type,
        size_bytes,
        ...(download_filename === undefined ? {} : { download_filename }),
        created_at,
      };
      const data = await this.#read_verified_payload(manifest);
      const stored_asset = manifest_asset(manifest, data);

      const publication = this.#kv.native_atomic()
        .check(existing)
        .set(manifest_storage_key, manifest);

      // An exception from commit has an ambiguous outcome. Retain the staged
      // payload because the manifest may already reference it.
      retain_payload = true;
      const published = await publication.commit();
      if (!published.ok) {
        retain_payload = this.#payload_staging_mode === "reuse-identical";
        return { ok: false, reason: "content_asset_id_conflict" };
      }
      return { ok: true, asset: stored_asset };
    } finally {
      if (cleanup_on_failure && !retain_payload) {
        await this.#cleanup_payload(payload_storage_key);
      }
    }
  }

  async find_content_asset_by_id(
    content_asset_id: ContentAssetId,
  ): Promise<ContentAsset | null> {
    require(
      is_valid_content_asset_id(content_asset_id),
      "content_asset_id must be a route-safe opaque id",
    );
    const entry = await this.find_content_asset_manifest_entry(
      content_asset_id,
    );
    if (entry === null) return null;
    const data = await this.#read_verified_payload(entry.value);
    return manifest_asset(entry.value, data);
  }

  async #stage_payload(
    key: Deno.KvKey,
    bytes: Uint8Array,
  ): Promise<boolean> {
    if (this.#payload_staging_mode === "new") {
      await this.#kv.stage_binary_object(key, bytes);
      return true;
    }

    const existing = await this.#kv.read_binary_object(key);
    if (existing !== null) {
      if (!bytes_equal(existing, bytes)) {
        throw new TypeError(
          "content asset repository: deterministic payload conflict",
        );
      }
      return false;
    }

    try {
      await this.#kv.stage_binary_object(key, bytes);
    } catch (error) {
      const raced = await this.#kv.read_binary_object(key);
      if (raced === null || !bytes_equal(raced, bytes)) throw error;
    }
    return false;
  }

  async #read_verified_payload(
    manifest: StoredContentAssetManifest,
  ): Promise<unknown> {
    let bytes: Uint8Array | null;
    try {
      bytes = await this.#kv.read_binary_object(
        content_asset_payload_key(manifest.payload_id),
      );
    } catch (error) {
      if (error instanceof TypeError) return invalid_stored_content_asset();
      throw error;
    }
    if (
      bytes === null || bytes.byteLength !== manifest.payload_byte_length ||
      await sha256(bytes) !== manifest.payload_sha256
    ) {
      return invalid_stored_content_asset();
    }
    try {
      return this.#codec.decode(bytes);
    } catch (error) {
      if (error instanceof TypeError) return invalid_stored_content_asset();
      throw error;
    }
  }

  async #cleanup_payload(key: Deno.KvKey): Promise<void> {
    try {
      await this.#kv.remove_binary_object(key);
    } catch {
      // The random key is unreachable; bounded reconciliation is separate work.
    }
  }
}
