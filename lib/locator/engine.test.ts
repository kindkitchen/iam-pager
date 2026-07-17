import { assertEquals, assertThrows } from "@std/assert";
import { LocatorEngine } from "./engine.ts";
import { PathSlugStrategy } from "./path-slug-strategy.ts";

function make_engine() {
  return new LocatorEngine({
    strategies: [new PathSlugStrategy()],
    forbidden_namespaces: ["site"],
  });
}

Deno.test("engine resolves through the default strategy", () => {
  assertEquals(make_engine().resolve("/ns/page"), {
    ok: true,
    locator: { namespace: "ns", page_name: "page" },
  });
});

Deno.test("forbidden namespaces are rejected case-insensitively", () => {
  const engine = make_engine();
  for (const path of ["/site", "/Site/page", "/SITE/a/b"]) {
    assertEquals(engine.resolve(path), {
      ok: false,
      reason: "forbidden_namespace",
    });
  }
});

Deno.test("strategy errors pass through the engine unchanged", () => {
  assertEquals(make_engine().resolve("/"), {
    ok: false,
    reason: "not_a_locator",
  });
});

Deno.test("validate accepts locators that roundtrip through the mapping", () => {
  assertEquals(
    make_engine().validate({ namespace: "My Ns", page_name: "notes/today" }),
    {
      ok: true,
      locator: { namespace: "My Ns", page_name: "notes/today" },
    },
  );
});

Deno.test("validate rejects ambiguous or undeliverable locators", () => {
  const engine = make_engine();
  for (
    const locator of [
      { namespace: "" },
      { namespace: "bad/name" },
      { namespace: "ns", page_name: "" },
      { namespace: "ns", page_name: "a//b" },
      { namespace: "ns", page_name: "../other" },
    ]
  ) {
    assertEquals(engine.validate(locator).ok, false);
  }
});

Deno.test("validate applies forbidden namespace policy", () => {
  assertEquals(make_engine().validate({ namespace: "SITE" }), {
    ok: false,
    reason: "forbidden_namespace",
  });
});

Deno.test("format refuses forbidden namespaces", () => {
  assertThrows(
    () => make_engine().format({ namespace: "Site" }),
    Error,
    "forbidden namespace",
  );
});

Deno.test("resolving with an unknown strategy throws", () => {
  assertThrows(
    () => make_engine().resolve("/ns", "subdomain"),
    Error,
    "unknown strategy",
  );
});

Deno.test("engine requires at least one strategy", () => {
  assertThrows(() => new LocatorEngine({ strategies: [] }), Error);
});

Deno.test("duplicate strategy names are rejected", () => {
  assertThrows(
    () =>
      new LocatorEngine({
        strategies: [new PathSlugStrategy(), new PathSlugStrategy()],
      }),
    Error,
    "duplicate strategy",
  );
});

Deno.test("unknown default strategy is rejected", () => {
  assertThrows(
    () =>
      new LocatorEngine({
        strategies: [new PathSlugStrategy()],
        default_strategy: "subdomain",
      }),
    Error,
    "unknown default strategy",
  );
});

Deno.test("is_forbidden exposes the policy for publish-side checks", () => {
  const engine = make_engine();
  assertEquals(engine.is_forbidden("SITE"), true);
  assertEquals(engine.is_forbidden("blog"), false);
});
