import type { ContentMeta } from "./model.ts";

/** Opaque identity for one immutable, fully materialized content asset. */
export type ContentAssetId = string;

/**
 * Stored content independent of page identity and endpoint behavior. Once
 * created, an asset is never updated in place; page replacement selects a new
 * asset identity instead.
 */
export interface ContentAsset<Data = unknown> {
  readonly content_asset_id: ContentAssetId;
  readonly content_type: string;
  readonly data: Data;
  readonly meta: Readonly<ContentMeta>;
  readonly created_at: Date;
}

/** Route-safe opaque id; deliberately the same storage-safe alphabet as pages. */
const content_asset_id_pattern = /^[A-Za-z0-9_-]{1,64}$/;

export function is_valid_content_asset_id(
  value: unknown,
): value is ContentAssetId {
  return typeof value === "string" && content_asset_id_pattern.test(value);
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
    !(asset.created_at instanceof Date) ||
    !Number.isFinite(asset.created_at.getTime())
  ) {
    return "created_at must be a valid date";
  }
  return null;
}
