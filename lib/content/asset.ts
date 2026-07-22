import {
  external_content_ref_violation,
  type ExternalContentRef,
} from "../external-storage/model.ts";
import type { ContentMeta } from "./model.ts";

/** Opaque identity for one immutable content asset. */
export type ContentAssetId = string;

export interface InlineContentAssetSource {
  readonly kind: "inline";
}

export interface ExternalContentAssetSource {
  readonly kind: "external";
  readonly ref: ExternalContentRef;
}

export type ContentAssetSource =
  | InlineContentAssetSource
  | ExternalContentAssetSource;

interface ContentAssetBase {
  readonly content_asset_id: ContentAssetId;
  readonly content_type: string;
  readonly meta: Readonly<ContentMeta>;
  readonly created_at: Date;
}

/** Canonical data materialized in application-owned persistence. */
export type InlineContentAsset<Data = unknown> = ContentAssetBase & {
  readonly source: InlineContentAssetSource;
  readonly data: Data;
};

/** Provider-owned canonical bytes with all authoritative facts kept locally. */
export type ExternalContentAsset = ContentAssetBase & {
  readonly source: ExternalContentAssetSource;
  readonly data?: never;
};

/**
 * Stored content independent of page identity and endpoint behavior. Once
 * created, an asset is never updated in place; page replacement selects a new
 * asset identity instead.
 */
export type ContentAsset<Data = unknown> =
  | InlineContentAsset<Data>
  | ExternalContentAsset;

/** Route-safe opaque id; deliberately the same storage-safe alphabet as pages. */
const content_asset_id_pattern = /^[A-Za-z0-9_-]{1,64}$/;
const content_codec_version_pattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const sha256_pattern = /^[0-9a-f]{64}$/;

export function is_valid_content_asset_id(
  value: unknown,
): value is ContentAssetId {
  return typeof value === "string" && content_asset_id_pattern.test(value);
}

export function is_valid_content_codec_version(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    content_codec_version_pattern.test(value);
}

export function is_valid_content_sha256(value: unknown): value is string {
  return typeof value === "string" && sha256_pattern.test(value);
}

export function is_inline_content_asset<Data>(
  asset: ContentAsset<Data>,
): asset is InlineContentAsset<Data> {
  return asset.source.kind === "inline";
}

/** First structural invariant violation, or null for a coherent asset. */
export function content_asset_violation(asset: ContentAsset): string | null {
  if (!is_valid_content_asset_id(asset.content_asset_id)) {
    return "content_asset_id must be a route-safe opaque id";
  }
  if (typeof asset.content_type !== "string" || asset.content_type === "") {
    return "content_type must be non-empty";
  }
  if (
    typeof asset.source !== "object" || asset.source === null ||
    Array.isArray(asset.source)
  ) {
    return "source must be inline or external";
  }
  if (asset.source.kind === "inline") {
    if (!Object.hasOwn(asset, "data")) {
      return "inline content asset must contain data";
    }
  } else if (asset.source.kind === "external") {
    const ref_violation = external_content_ref_violation(asset.source.ref);
    if (ref_violation !== null) return ref_violation;
    if (Object.hasOwn(asset, "data")) {
      return "external content asset must not contain data";
    }
  } else {
    return "source must be inline or external";
  }
  if (
    typeof asset.meta !== "object" || asset.meta === null ||
    typeof asset.meta.media_type !== "string" || asset.meta.media_type === ""
  ) {
    return "media_type must be non-empty";
  }
  if (
    !Number.isSafeInteger(asset.meta.size_bytes) ||
    asset.meta.size_bytes < 0
  ) {
    return "size_bytes must be a non-negative safe integer";
  }
  if (
    asset.meta.download_filename !== undefined &&
    typeof asset.meta.download_filename !== "string"
  ) {
    return "download_filename must be a string when present";
  }
  if (
    asset.meta.sha256 !== undefined &&
    !is_valid_content_sha256(asset.meta.sha256)
  ) {
    return "sha256 must be a lowercase SHA-256 digest";
  }
  if (
    asset.meta.codec_version !== undefined &&
    !is_valid_content_codec_version(asset.meta.codec_version)
  ) {
    return "codec_version must be a bounded storage-safe identifier";
  }
  if (
    asset.source.kind === "external" &&
    !is_valid_content_sha256(asset.meta.sha256)
  ) {
    return "external content asset requires sha256";
  }
  if (
    asset.source.kind === "external" &&
    !is_valid_content_codec_version(asset.meta.codec_version)
  ) {
    return "external content asset requires codec_version";
  }
  if (
    !(asset.created_at instanceof Date) ||
    !Number.isFinite(asset.created_at.getTime())
  ) {
    return "created_at must be a valid date";
  }
  return null;
}
