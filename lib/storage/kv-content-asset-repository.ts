import {
  content_asset_violation,
  type ContentAsset,
  type ContentAssetId,
  type ContentAssetSource,
  is_inline_content_asset,
  is_valid_content_asset_id,
  is_valid_content_codec_version,
  is_valid_content_sha256,
} from "../content/asset.ts";
import { external_content_ref_violation } from "../external-storage/model.ts";
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
import { is_exact_record, is_valid_stored_date } from "./record.ts";

export const content_asset_manifest_prefix: Deno.KvKey = [
  "iam-pager",
  "content-assets",
  "by-id",
];
export const content_asset_payload_prefix: Deno.KvKey = [
  "iam-pager",
  "content-assets",
  "payloads",
];

interface StoredContentAssetManifestBase {
  readonly content_asset_id: string;
  readonly content_type: string;
  readonly media_type: string;
  readonly size_bytes: number;
  readonly download_filename?: string;
  readonly sha256?: string;
  readonly codec_version?: string;
  readonly created_at: Date;
}

/** Legacy manifests omit `source`; all newly written inline manifests include it. */
export interface StoredInlineContentAssetManifest
  extends StoredContentAssetManifestBase {
  readonly source?: { readonly kind: "inline" };
  readonly data_encoding: string;
  readonly payload_id: string;
  readonly payload_byte_length: number;
  readonly payload_sha256: string;
}

/** External manifests contain no adapter-owned payload locator or encoded data. */
export interface StoredExternalContentAssetManifest
  extends StoredContentAssetManifestBase {
  readonly source: Extract<ContentAssetSource, { readonly kind: "external" }>;
  readonly sha256: string;
  readonly codec_version: string;
}

export type StoredContentAssetManifest =
  | StoredInlineContentAssetManifest
  | StoredExternalContentAssetManifest;

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

export interface KvContentAssetRepositoryOptions {
  readonly codec?: ContentDataCodec;
  readonly payload_id_generator?: ContentAssetPayloadIdGenerator;
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
  const common_fields = [
    "content_asset_id",
    "content_type",
    "media_type",
    "size_bytes",
    "created_at",
  ];
  const source = stored.source;
  const is_legacy_inline = source === undefined;
  const is_inline = is_legacy_inline ||
    (is_exact_record(source, ["kind"]) && source.kind === "inline");
  const is_external = is_exact_record(source, ["kind", "ref"]) &&
    source.kind === "external" &&
    is_exact_record(
      source.ref,
      ["provider_id", "connection_id", "external_ref"],
      ["version_hint"],
    ) && external_content_ref_violation(source.ref) === null;

  if (
    stored.content_asset_id !== expected_content_asset_id ||
    !is_valid_content_asset_id(stored.content_asset_id) ||
    typeof stored.content_type !== "string" || stored.content_type === "" ||
    typeof stored.media_type !== "string" || stored.media_type === "" ||
    !Number.isSafeInteger(stored.size_bytes) ||
    (stored.size_bytes as number) < 0 ||
    (stored.download_filename !== undefined &&
      typeof stored.download_filename !== "string") ||
    (stored.sha256 !== undefined &&
      !is_valid_content_sha256(stored.sha256)) ||
    (stored.codec_version !== undefined &&
      !is_valid_content_codec_version(stored.codec_version)) ||
    !is_valid_stored_date(stored.created_at)
  ) {
    return invalid_stored_content_asset();
  }

  if (is_inline) {
    if (
      !is_exact_record(stored, [
        ...common_fields,
        "data_encoding",
        "payload_id",
        "payload_byte_length",
        "payload_sha256",
      ], ["source", "download_filename", "sha256", "codec_version"]) ||
      stored.data_encoding !== expected_data_encoding ||
      !is_valid_content_asset_id(stored.payload_id) ||
      !Number.isSafeInteger(stored.payload_byte_length) ||
      (stored.payload_byte_length as number) < 1 ||
      !is_valid_content_sha256(stored.payload_sha256)
    ) {
      return invalid_stored_content_asset();
    }
    return stored as unknown as StoredInlineContentAssetManifest;
  }

  if (
    !is_external ||
    !is_exact_record(stored, [
      ...common_fields,
      "source",
      "sha256",
      "codec_version",
    ], ["download_filename"]) ||
    !is_valid_content_sha256(stored.sha256) ||
    !is_valid_content_codec_version(stored.codec_version)
  ) {
    return invalid_stored_content_asset();
  }
  return stored as unknown as StoredExternalContentAssetManifest;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function is_external_manifest(
  manifest: StoredContentAssetManifest,
): manifest is StoredExternalContentAssetManifest {
  return manifest.source?.kind === "external";
}

function manifest_asset(
  manifest: StoredContentAssetManifest,
  data?: unknown,
): ContentAsset {
  const source = manifest.source ?? { kind: "inline" as const };
  const common = {
    content_asset_id: manifest.content_asset_id,
    content_type: manifest.content_type,
    meta: {
      media_type: manifest.media_type,
      size_bytes: manifest.size_bytes,
      ...(manifest.download_filename === undefined
        ? {}
        : { download_filename: manifest.download_filename }),
      ...(manifest.sha256 === undefined ? {} : { sha256: manifest.sha256 }),
      ...(manifest.codec_version === undefined
        ? {}
        : { codec_version: manifest.codec_version }),
    },
    created_at: new Date(manifest.created_at),
  };
  const asset: ContentAsset = source.kind === "inline"
    ? { ...common, source, data }
    : { ...common, source };
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

  constructor(
    kv: KvGateway,
    options: KvContentAssetRepositoryOptions = {},
  ) {
    this.#kv = kv;
    this.#codec = options.codec ?? new V8ContentDataCodec();
    this.#payload_id_generator = options.payload_id_generator ??
      new CryptoContentAssetPayloadIdGenerator();
    require(
      typeof this.#codec.encoding === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(this.#codec.encoding),
      "codec encoding must be a storage-safe identifier",
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
        this.#codec.encoding,
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
    const source = structuredClone(asset.source);
    const media_type = asset.meta.media_type;
    const size_bytes = asset.meta.size_bytes;
    const download_filename = asset.meta.download_filename;
    const content_sha256 = asset.meta.sha256;
    const codec_version = asset.meta.codec_version;
    const created_at = new Date(asset.created_at);
    const inline_data = is_inline_content_asset(asset)
      ? structuredClone(asset.data)
      : undefined;

    const manifest_storage_key = content_asset_manifest_key(content_asset_id);
    const existing = await this.#kv.get<unknown>(manifest_storage_key);
    if (existing.versionstamp !== null) {
      deserialize_manifest(
        content_asset_id,
        this.#codec.encoding,
        existing,
      );
      return { ok: false, reason: "content_asset_id_conflict" };
    }

    if (source.kind === "external") {
      const manifest: StoredExternalContentAssetManifest = {
        content_asset_id,
        content_type,
        source,
        media_type,
        size_bytes,
        ...(download_filename === undefined ? {} : { download_filename }),
        sha256: content_sha256!,
        codec_version: codec_version!,
        created_at,
      };
      const stored_asset = manifest_asset(manifest);
      const published = await this.#kv.native_atomic()
        .check(existing)
        .set(manifest_storage_key, manifest)
        .commit();
      return published.ok
        ? { ok: true, asset: stored_asset }
        : { ok: false, reason: "content_asset_id_conflict" };
    }

    const encoded = this.#codec.encode(inline_data);
    if (!(encoded instanceof Uint8Array) || encoded.byteLength === 0) {
      throw new TypeError(
        "content asset repository: codec must produce non-empty bytes",
      );
    }
    const payload_bytes = encoded.slice();
    const payload_sha256 = await sha256(payload_bytes);
    const payload_id = this.#payload_id_generator.generate();
    require(
      is_valid_content_asset_id(payload_id),
      "payload id generator produced an invalid id",
    );
    const payload_storage_key = content_asset_payload_key(payload_id);

    let cleanup_on_failure = false;
    let retain_payload = false;
    try {
      await this.#kv.stage_binary_object(payload_storage_key, payload_bytes);
      cleanup_on_failure = true;

      const manifest: StoredInlineContentAssetManifest = {
        data_encoding: this.#codec.encoding,
        content_asset_id,
        source,
        payload_id,
        payload_byte_length: payload_bytes.byteLength,
        payload_sha256,
        content_type,
        media_type,
        size_bytes,
        ...(download_filename === undefined ? {} : { download_filename }),
        ...(content_sha256 === undefined ? {} : { sha256: content_sha256 }),
        ...(codec_version === undefined ? {} : { codec_version }),
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
        retain_payload = false;
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
    if (is_external_manifest(entry.value)) return manifest_asset(entry.value);
    const data = await this.#read_verified_payload(entry.value);
    return manifest_asset(entry.value, data);
  }

  async #read_verified_payload(
    manifest: StoredInlineContentAssetManifest,
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
