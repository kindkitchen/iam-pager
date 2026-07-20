import { v8Deserialize, v8Serialize } from "@olli/kvdex/encoding/v8";
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
  create_kvdex_content_database,
  kvdex_content_asset_payload_id_prefix,
  kvdex_content_asset_payload_segment_prefix,
  type StoredContentAssetManifest,
} from "./kvdex-content-database.ts";

const storage_schema_version = 1;

function require(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`kvdex content repository: ${message}`);
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

function deserialize_manifest(
  expected_content_asset_id: ContentAssetId,
  value: unknown,
): StoredContentAssetManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid_stored_content_asset();
  }
  const stored = value as Record<string, unknown>;
  if (
    !has_exact_keys(stored, [
      "schema_version",
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
    (stored.download_filename !== undefined &&
      typeof stored.download_filename !== "string")
  ) {
    return invalid_stored_content_asset();
  }
  deserialize_date(stored.created_at);
  return stored as StoredContentAssetManifest;
}

function serialize_data(data: unknown): Uint8Array {
  try {
    return v8Serialize(data);
  } catch {
    throw new TypeError(
      "kvdex content repository: content asset data must be serializable",
    );
  }
}

function deserialize_data(bytes: Uint8Array): unknown {
  try {
    return v8Deserialize(bytes);
  } catch {
    return invalid_stored_content_asset();
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest_input = new Uint8Array(bytes.length);
  digest_input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digest_input);
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
 * Immutable Kvdex content-asset adapter. Encoded payloads are written under a
 * random staging identity and reconstructed, length-checked, and hash-checked
 * before one unencoded manifest makes the application asset identity visible.
 */
export class KvdexContentAssetRepository
  implements ContentAssetCreator, ContentAssetReader {
  readonly #kv: Deno.Kv;
  readonly #database: ReturnType<typeof create_kvdex_content_database>;

  constructor(kv: Deno.Kv) {
    this.#kv = kv;
    this.#database = create_kvdex_content_database(kv);
  }

  async create_content_asset(
    asset: ContentAsset,
  ): Promise<CreateContentAssetResult> {
    const violation = content_asset_violation(asset);
    require(violation === null, violation ?? "invalid content asset");

    const existing = await this.#database.iam_pager.content_assets.manifests
      .find(asset.content_asset_id);
    if (existing !== null) {
      deserialize_manifest(existing.id, existing.value);
      return { ok: false, reason: "content_asset_id_conflict" };
    }

    const payload_bytes = serialize_data(asset.data);
    const payload_sha256 = await sha256(payload_bytes);
    const payload_id = crypto.randomUUID();
    const staged = await this.#database.iam_pager.content_assets.payloads.set(
      payload_id,
      payload_bytes,
      { batched: true },
    );
    if (!staged.ok) {
      await this.#cleanup_payload(payload_id);
      throw new Error("kvdex content repository: failed to stage payload");
    }

    let retain_payload = false;
    try {
      const data = await this.#read_verified_payload(
        payload_id,
        payload_bytes.length,
        payload_sha256,
      );
      const manifest: StoredContentAssetManifest = {
        schema_version: storage_schema_version,
        content_asset_id: asset.content_asset_id,
        payload_id,
        payload_byte_length: payload_bytes.length,
        payload_sha256,
        content_type: asset.content_type,
        media_type: asset.meta.media_type,
        size_bytes: asset.meta.size_bytes,
        ...(asset.meta.download_filename === undefined
          ? {}
          : { download_filename: asset.meta.download_filename }),
        created_at: asset.created_at.toISOString(),
      };
      const stored_asset = manifest_asset(manifest, data);

      // Once publication starts, an exception has an ambiguous commit outcome.
      // Retain the payload rather than risk corrupting a visible manifest.
      retain_payload = true;
      const published = await this.#database.iam_pager.content_assets.manifests
        .set(asset.content_asset_id, manifest);
      if (!published.ok) {
        retain_payload = false;
        return { ok: false, reason: "content_asset_id_conflict" };
      }
      return { ok: true, asset: stored_asset };
    } finally {
      if (!retain_payload) await this.#cleanup_payload(payload_id);
    }
  }

  async find_content_asset_by_id(
    content_asset_id: ContentAssetId,
  ): Promise<ContentAsset | null> {
    require(
      is_valid_content_asset_id(content_asset_id),
      "content_asset_id must be a route-safe opaque id",
    );
    const document = await this.#database.iam_pager.content_assets.manifests
      .find(content_asset_id);
    if (document === null) return null;
    const manifest = deserialize_manifest(document.id, document.value);
    const data = await this.#read_verified_payload(
      manifest.payload_id,
      manifest.payload_byte_length,
      manifest.payload_sha256,
    );
    return manifest_asset(manifest, data);
  }

  async #read_verified_payload(
    payload_id: string,
    expected_byte_length: number,
    expected_sha256: string,
  ): Promise<unknown> {
    let document;
    try {
      document = await this.#database.iam_pager.content_assets.payloads.find(
        payload_id,
      );
    } catch {
      return invalid_stored_content_asset();
    }
    if (
      document === null || !(document.value instanceof Uint8Array) ||
      document.value.length !== expected_byte_length ||
      await sha256(document.value) !== expected_sha256
    ) {
      return invalid_stored_content_asset();
    }
    return deserialize_data(document.value);
  }

  async #cleanup_payload(payload_id: string): Promise<void> {
    try {
      await this.#database.iam_pager.content_assets.payloads.delete(payload_id);
    } catch {
      // Continue with the pinned-layout cleanup below.
    }
    try {
      await this.#kv.delete([
        ...kvdex_content_asset_payload_id_prefix,
        payload_id,
      ]);
      const keys: Deno.KvKey[] = [];
      for await (
        const entry of this.#kv.list({
          prefix: [
            ...kvdex_content_asset_payload_segment_prefix,
            payload_id,
          ],
        })
      ) {
        keys.push([...entry.key]);
      }
      await Promise.all(keys.map((key) => this.#kv.delete(key)));
    } catch {
      // An unreachable staging orphan is safe and can be reconciled later.
    }
  }
}
