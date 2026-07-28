import { assertEquals } from "@std/assert";
import type { ShortLinkResolver } from "./model.ts";
import { expand_short_links, to_route_url_async } from "./short-link.ts";

const resolver: ShortLinkResolver = {
  expand: (url) =>
    Promise.resolve(
      url.endsWith("home")
        ? "https://www.google.com/maps/search/?api=1&query=Home"
        : "https://www.google.com/maps/search/?api=1&query=Office",
    ),
};

Deno.test("short links are expanded before routing", async () => {
  assertEquals(
    await to_route_url_async("https://maps.app.goo.gl/home", { resolver }),
    "https://www.google.com/maps/dir/?api=1&destination=Home",
  );
});

Deno.test("many short links chain in argument order", async () => {
  assertEquals(
    await to_route_url_async(
      "https://maps.app.goo.gl/home",
      "https://goo.gl/maps/office",
      { resolver, travel_mode: "transit" },
    ),
    "https://www.google.com/maps/dir/?api=1&origin=Home&destination=Office&travelmode=transit",
  );
});

Deno.test("non short inputs pass through the expander untouched", async () => {
  assertEquals(await expand_short_links(["Kyiv"], resolver), ["Kyiv"]);
});
