import { assertEquals } from "@std/assert";
import {
  content_asset_violation,
  type ContentAsset,
  is_inline_content_asset,
} from "./asset.ts";

const created_at = new Date("2026-07-22T12:00:00.000Z");

function inline_asset(): ContentAsset {
  return {
    content_asset_id: "inline-asset",
    content_type: "md-page",
    source: { kind: "inline" },
    data: { md: "# Inline" },
    meta: { media_type: "text/html; charset=utf-8", size_bytes: 18 },
    created_at,
  };
}

function external_asset(): ContentAsset {
  return {
    content_asset_id: "external-asset",
    content_type: "pdf",
    source: {
      kind: "external",
      ref: {
        provider_id: "google-drive",
        connection_id: "connection-1",
        external_ref: "opaque/provider/object",
        version_hint: "version-1",
      },
    },
    meta: {
      media_type: "application/pdf",
      size_bytes: 1024,
      download_filename: "document.pdf",
      sha256: "a".repeat(64),
      codec_version: "pdf-v1",
    },
    created_at,
  };
}

Deno.test("content assets discriminate inline data from external references", () => {
  const inline = inline_asset();
  const external = external_asset();
  assertEquals(content_asset_violation(inline), null);
  assertEquals(content_asset_violation(external), null);
  assertEquals(is_inline_content_asset(inline), true);
  assertEquals(is_inline_content_asset(external), false);
  assertEquals(Object.hasOwn(external, "data"), false);
});

Deno.test("external content assets require bounded references and integrity facts", () => {
  assertEquals(
    content_asset_violation({
      ...external_asset(),
      meta: { media_type: "application/pdf", size_bytes: 1024 },
    } as ContentAsset),
    "external content asset requires sha256",
  );
  assertEquals(
    content_asset_violation({
      ...external_asset(),
      meta: {
        media_type: "application/pdf",
        size_bytes: 1024,
        sha256: "a".repeat(64),
      },
    } as ContentAsset),
    "external content asset requires codec_version",
  );
  assertEquals(
    content_asset_violation({
      ...external_asset(),
      source: {
        kind: "external",
        ref: {
          provider_id: "Google Drive",
          connection_id: "connection-1",
          external_ref: "object",
        },
      },
    } as ContentAsset),
    "provider_id must be a route-safe lowercase ID",
  );
  assertEquals(
    content_asset_violation({
      ...external_asset(),
      data: Uint8Array.of(1),
    } as unknown as ContentAsset),
    "external content asset must not contain data",
  );
});

Deno.test("inline content assets require explicit materialized data", () => {
  const { data: _data, ...missing_data } = inline_asset() as Extract<
    ContentAsset,
    { source: { kind: "inline" } }
  >;
  assertEquals(
    content_asset_violation(missing_data as unknown as ContentAsset),
    "inline content asset must contain data",
  );
  assertEquals(
    content_asset_violation({
      ...inline_asset(),
      meta: {
        media_type: "text/html",
        size_bytes: 1,
        sha256: "not-a-digest",
      },
    }),
    "sha256 must be a lowercase SHA-256 digest",
  );
});
