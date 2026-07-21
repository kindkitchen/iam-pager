import { assertEquals, assertThrows } from "@std/assert";
import { format_api_key_etag, parse_api_key_etag } from "./etag.ts";

Deno.test("format produces a strong validator and rejects invalid input", () => {
  assertEquals(format_api_key_etag("key-1", 3), '"api-key-key-1-r3"');
  assertThrows(() => format_api_key_etag("", 1));
  assertThrows(() => format_api_key_etag("key 1", 1));
  assertThrows(() => format_api_key_etag("key-1", 0));
  assertThrows(() => format_api_key_etag("key-1", 1.5));
});

Deno.test("parse accepts exactly one strong API-key ETag", () => {
  assertEquals(parse_api_key_etag('"api-key-key-1-r3"'), {
    api_key_id: "key-1",
    revision: 3,
  });
  const uuid = crypto.randomUUID();
  assertEquals(parse_api_key_etag(`"api-key-${uuid}-r12"`), {
    api_key_id: uuid,
    revision: 12,
  });
  for (
    const rejected of [
      null,
      "",
      "api-key-key-1-r3",
      'W/"api-key-key-1-r3"',
      '"api-key-key-1-r0"',
      '"api-key-key-1-r03"',
      '"page-key-1-r3"',
      '"api-key-key-1-r3", "api-key-key-2-r4"',
      ' "api-key-key-1-r3"',
      "*",
    ]
  ) {
    assertEquals(parse_api_key_etag(rejected), null, String(rejected));
  }
});
