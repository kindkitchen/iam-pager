import { assertEquals, assertThrows } from "@std/assert";
import { format_page_etag, parse_page_etag } from "./etag.ts";

Deno.test("page ETags round-trip route-safe ids and revisions", () => {
  const etag = format_page_etag("page_A-r-token", 42);
  assertEquals(etag, '"page-page_A-r-token-r42"');
  assertEquals(parse_page_etag(etag), {
    page_id: "page_A-r-token",
    revision: 42,
  });
});

Deno.test("page ETag parser rejects ambiguous and non-canonical validators", () => {
  for (
    const value of [
      null,
      "",
      "*",
      'W/"page-id-r1"',
      '"page-id-r1", "page-id-r2"',
      ' "page-id-r1"',
      '"page-id-r1" ',
      '"page-id-r01"',
      '"page-id-r0"',
      '"page-id-r1.0"',
      '"page-id-r9007199254740992"',
      '"page-bad.id-r1"',
      '"other-id-r1"',
    ]
  ) {
    assertEquals(parse_page_etag(value), null, value ?? "null");
  }
});

Deno.test("page ETag formatter rejects invalid application values", () => {
  assertThrows(() => format_page_etag("bad.id", 1));
  assertThrows(() => format_page_etag("valid-id", 0));
});
