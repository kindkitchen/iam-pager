import { assertEquals } from "@std/assert";
import type { ShortLinkResolver } from "../maps/model.ts";
import {
  map_link_expansion_status,
  ShortLinkExpansionService,
} from "./map-link-expansion.ts";

const resolver: ShortLinkResolver = {
  expand: (url) =>
    url.endsWith("broken")
      ? Promise.reject(new Error("no"))
      : url.endsWith("junk")
      ? Promise.resolve("https://example.com/")
      : Promise.resolve("https://www.google.com/maps/search/?api=1&query=Kyiv"),
};

const service = new ShortLinkExpansionService(resolver);

Deno.test("an official short link expands to its canonical maps URL", async () => {
  const result = await service.expand("https://maps.app.goo.gl/abc123");
  assertEquals(result, {
    ok: true,
    url: "https://www.google.com/maps/search/?api=1&query=Kyiv",
  });
  assertEquals(map_link_expansion_status(result), 200);
});

Deno.test("only short links are ever dereferenced", async () => {
  for (
    const input of [
      "https://example.com/redirect",
      "https://www.google.com/maps/search/?api=1&query=Kyiv",
      42,
      "x".repeat(4096),
    ]
  ) {
    const result = await service.expand(input);
    assertEquals(result, { ok: false, reason: "not_a_short_link" });
    assertEquals(map_link_expansion_status(result), 400);
  }
});

Deno.test("a failed or non-maps expansion is reported as unreachable", async () => {
  const failed = await service.expand("https://maps.app.goo.gl/broken");
  assertEquals(failed, { ok: false, reason: "unreachable" });
  assertEquals(map_link_expansion_status(failed), 502);
  assertEquals(await service.expand("https://goo.gl/maps/junk"), {
    ok: false,
    reason: "unreachable",
  });
});
