import type { ContentAsset, ContentAssetId } from "./asset.ts";
import type { DeliveryPayload, DeliveryProfile } from "./model.ts";

/** Produces opaque route-safe immutable asset identities. */
export interface ContentAssetIdGenerator {
  generate(): ContentAssetId;
}

export type CreateContentAssetResult =
  | { readonly ok: true; readonly asset: ContentAsset }
  | { readonly ok: false; readonly reason: "content_asset_id_conflict" };

/** Creates immutable assets; an existing identity is never overwritten. */
export interface ContentAssetCreator {
  create_content_asset(asset: ContentAsset): Promise<CreateContentAssetResult>;
}

/** Internal asset access. Public delivery must first resolve an eligible page. */
export interface ContentAssetReader {
  find_content_asset_by_id(
    content_asset_id: ContentAssetId,
  ): Promise<ContentAsset | null>;
}

export type ContentResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/**
 * Interface-first content CRUD: a content type becomes usable by satisfying
 * this interface, without further wiring.
 *
 * `validate` and `derive` run at publish time so derived representations
 * (e.g. html from md) are stored once, not rebuilt per request. `render`
 * runs at delivery time.
 */
export interface ContentTypeHandler<Input, Data, Management = Input> {
  readonly content_type: string;
  /** Non-empty endpoint profiles this content type can safely deliver. */
  readonly supported_delivery_profiles: readonly DeliveryProfile[];
  /** Check untrusted input and narrow it to the type's input shape. */
  validate(input: unknown): ContentResult<Input>;
  /** Derive the stored data from valid input (e.g. md -> md + html). */
  derive(input: Input): Data;
  /**
   * Produce a bounded owner-safe management representation. Text handlers may
   * return resubmittable source; binary handlers must not expose payload bytes
   * or backend-internal fields.
   */
  to_management(data: Data): Management;
  /** Produce the raw delivery payload for stored data. */
  render(data: Data): DeliveryPayload;
}
