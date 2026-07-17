import { assertEquals } from "@std/assert";
import { PathSlugStrategy } from "./path-slug-strategy.ts";

const strategy = new PathSlugStrategy();

Deno.test("root path is not a locator", () => {
  assertEquals(strategy.resolve("/"), { ok: false, reason: "not_a_locator" });
  assertEquals(strategy.resolve(""), { ok: false, reason: "not_a_locator" });
});

Deno.test("single slug resolves to a default-page locator", () => {
  assertEquals(strategy.resolve("/my-ns"), {
    ok: true,
    locator: { namespace: "my-ns" },
  });
});

Deno.test("trailing and doubled slashes are tolerated", () => {
  assertEquals(strategy.resolve("/my-ns/"), {
    ok: true,
    locator: { namespace: "my-ns" },
  });
  assertEquals(strategy.resolve("/my-ns//page"), {
    ok: true,
    locator: { namespace: "my-ns", page_name: "page" },
  });
});

Deno.test("remaining slugs join into one page name", () => {
  assertEquals(strategy.resolve("/ns/a/b/c"), {
    ok: true,
    locator: { namespace: "ns", page_name: "a/b/c" },
  });
});

Deno.test("percent-encoded segments are decoded", () => {
  assertEquals(strategy.resolve("/my%20ns/some%20page"), {
    ok: true,
    locator: { namespace: "my ns", page_name: "some page" },
  });
});

Deno.test("casing is preserved in the resolved locator", () => {
  assertEquals(strategy.resolve("/MyNs/MyPage"), {
    ok: true,
    locator: { namespace: "MyNs", page_name: "MyPage" },
  });
});

Deno.test("broken percent-encoding is an invalid segment", () => {
  assertEquals(strategy.resolve("/ns/%zz"), {
    ok: false,
    reason: "invalid_segment",
  });
});

Deno.test("dot segments are invalid", () => {
  assertEquals(strategy.resolve("/ns/../etc"), {
    ok: false,
    reason: "invalid_segment",
  });
  assertEquals(strategy.resolve("/./ns"), {
    ok: false,
    reason: "invalid_segment",
  });
});

Deno.test("encoded slash inside a segment is invalid", () => {
  assertEquals(strategy.resolve("/ns/a%2Fb"), {
    ok: false,
    reason: "invalid_segment",
  });
});

Deno.test("format builds the direct path for a locator", () => {
  assertEquals(strategy.format({ namespace: "ns" }), "/ns");
  assertEquals(
    strategy.format({ namespace: "my ns", page_name: "a/b" }),
    "/my%20ns/a/b",
  );
});

Deno.test("format and resolve roundtrip", () => {
  const locators = [
    { namespace: "ns" },
    { namespace: "ns", page_name: "page" },
    { namespace: "My Ns", page_name: "Deep/Page Name" },
  ];
  for (const locator of locators) {
    const resolved = strategy.resolve(strategy.format(locator));
    assertEquals(resolved, { ok: true, locator });
  }
});
