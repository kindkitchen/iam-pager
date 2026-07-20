import { collection, kvdex, model } from "@olli/kvdex";
import { v8Encoder } from "@olli/kvdex/encoding/v8";

/** Adapter-owned record published only after its encoded payload is verified. */
export type StoredContentAssetManifest = {
  readonly schema_version: 1;
  readonly content_asset_id: string;
  readonly payload_id: string;
  readonly payload_byte_length: number;
  readonly payload_sha256: string;
  readonly content_type: string;
  readonly media_type: string;
  readonly size_bytes: number;
  readonly download_filename?: string;
  readonly created_at: string;
};

const schema = {
  iam_pager: {
    content_assets: {
      manifests: collection(model<StoredContentAssetManifest>()),
      payloads: collection(model<Uint8Array>(), {
        encoder: v8Encoder(),
      }),
    },
  },
};

/** Kvdex 3.6.7 physical prefixes used only for bounded staging cleanup. */
export const kvdex_content_asset_payload_id_prefix: Deno.KvKey = [
  "__kvdex__",
  "iam_pager",
  "content_assets",
  "payloads",
  "__id__",
];
export const kvdex_content_asset_payload_segment_prefix: Deno.KvKey = [
  "__kvdex__",
  "iam_pager",
  "content_assets",
  "payloads",
  "__segment__",
];

/**
 * Builds the adapter schema over a caller-owned KV instance. The Kvdex database
 * type stays inside storage implementation files; composition supplies Deno KV.
 */
export function create_kvdex_content_database(kv: Deno.Kv) {
  return kvdex({ kv, schema });
}
