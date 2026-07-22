import { assertEquals } from "@std/assert";
import {
  external_content_ref_violation,
  external_storage_capabilities,
  has_external_storage_capability,
  is_external_connection_id,
  is_external_content_ref,
  is_external_fetch_bound,
  is_external_provider_id,
  max_external_ref_length,
  max_external_version_hint_length,
} from "./model.ts";

Deno.test("external provider and connection IDs are bounded and route-safe", () => {
  assertEquals(is_external_provider_id("google-drive"), true);
  assertEquals(is_external_provider_id(`a${"1".repeat(63)}`), true);
  for (
    const value of [
      "",
      "Google",
      "google_drive",
      "1-drive",
      `a${"1".repeat(64)}`,
    ]
  ) {
    assertEquals(is_external_provider_id(value), false);
  }

  for (const value of ["connection-1", "Connection_1", "a"]) {
    assertEquals(is_external_connection_id(value), true);
  }
  for (const value of ["", "connection/1", "x".repeat(65)]) {
    assertEquals(is_external_connection_id(value), false);
  }
});

Deno.test("external content references accept bounded opaque provider values", () => {
  const content_ref = {
    provider_id: "google-drive",
    connection_id: "connection_1",
    external_ref: `folder/file:${"x".repeat(max_external_ref_length - 12)}`,
    version_hint: "version-1",
  };
  assertEquals(is_external_content_ref(content_ref), true);
  assertEquals(external_content_ref_violation(content_ref), null);

  assertEquals(
    external_content_ref_violation({ ...content_ref, provider_id: "Google" }),
    "provider_id must be a route-safe lowercase ID",
  );
  assertEquals(
    external_content_ref_violation({ ...content_ref, connection_id: "bad/id" }),
    "connection_id must be a route-safe opaque ID",
  );
  for (
    const external_ref of [
      "",
      "bad\nref",
      "x".repeat(max_external_ref_length + 1),
    ]
  ) {
    assertEquals(
      external_content_ref_violation({ ...content_ref, external_ref }),
      "external_ref must be non-empty bounded text without controls",
    );
  }
  for (
    const version_hint of [
      "",
      "bad\u007fhint",
      "x".repeat(max_external_version_hint_length + 1),
    ]
  ) {
    assertEquals(
      external_content_ref_violation({ ...content_ref, version_hint }),
      "version_hint must be non-empty bounded text without controls",
    );
  }
});

Deno.test("external fetch bounds and capabilities are explicit", () => {
  assertEquals(is_external_fetch_bound(0), true);
  assertEquals(is_external_fetch_bound(Number.MAX_SAFE_INTEGER), true);
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assertEquals(is_external_fetch_bound(value), false);
  }
  assertEquals(external_storage_capabilities, ["read", "write", "delete"]);
  assertEquals(has_external_storage_capability(["read"], "read"), true);
  assertEquals(has_external_storage_capability(["read"], "write"), false);
});
