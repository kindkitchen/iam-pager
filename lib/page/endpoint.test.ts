import { assert, assertEquals, assertThrows } from "@std/assert";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import type { PageEndpointBinding } from "./endpoint.ts";
import {
  DefaultPageEndpointPlanner,
  is_safe_page_path,
  project_page_endpoint_links,
} from "./endpoint.ts";

function make_planner(): DefaultPageEndpointPlanner {
  return new DefaultPageEndpointPlanner(
    new LocatorEngine({
      strategies: [new PathSlugStrategy()],
      forbidden_namespaces: ["api", "auth", "site"],
    }),
  );
}

function endpoint(
  page_name: string | undefined,
  delivery_profile: "inline" | "attachment" = "inline",
  namespace = "Alice",
): PageEndpointBinding {
  return {
    locator: page_name === undefined ? { namespace } : { namespace, page_name },
    delivery_profile,
  };
}

Deno.test("endpoint links preserve canonical structure and format safe paths", () => {
  const links = project_page_endpoint_links({
    canonical: endpoint("Preview", "inline"),
    alternates: [endpoint("Download copy", "attachment")],
  }, new LocatorEngine({ strategies: [new PathSlugStrategy()] }));
  assertEquals(links, {
    canonical: {
      locator: { namespace: "Alice", page_name: "Preview" },
      path: "/Alice/Preview",
      delivery_profile: "inline",
    },
    alternates: [{
      locator: { namespace: "Alice", page_name: "Download copy" },
      path: "/Alice/Download%20copy",
      delivery_profile: "attachment",
    }],
  });
  assert(is_safe_page_path(links.canonical.path));
  assertEquals(is_safe_page_path("//outside.test/page"), false);
  assertEquals(is_safe_page_path("/page?next=outside"), false);
  assertEquals(is_safe_page_path("javascript:alert(1)"), false);
});

Deno.test("endpoint link projection rejects unsafe formatter output", () => {
  assertThrows(
    () =>
      project_page_endpoint_links({
        canonical: endpoint("page"),
        alternates: [],
      }, { format: () => "//outside.test/page" }),
    Error,
    "unsafe path",
  );
});

Deno.test("endpoint planner accepts one canonical endpoint", () => {
  assertEquals(
    make_planner().plan({
      endpoint_set: { canonical: endpoint(undefined) },
      supported_delivery_profiles: ["inline"],
    }),
    {
      ok: true,
      endpoint_set: {
        canonical: endpoint(undefined),
        alternates: [],
      },
    },
  );
});

Deno.test("endpoint planner accepts many references and orders alternates", () => {
  const alternates = Array.from(
    { length: 16 },
    (_, index) => endpoint(`path-${16 - index}`, "attachment"),
  );
  const result = make_planner().plan({
    endpoint_set: {
      canonical: endpoint("Report", "inline"),
      alternates,
    },
    supported_delivery_profiles: ["inline", "attachment"],
  });
  assert(result.ok);
  assertEquals(result.endpoint_set.alternates.length, 16);
  assertEquals(
    result.endpoint_set.alternates.map((binding) => binding.locator.page_name),
    [
      "path-1",
      "path-10",
      "path-11",
      "path-12",
      "path-13",
      "path-14",
      "path-15",
      "path-16",
      "path-2",
      "path-3",
      "path-4",
      "path-5",
      "path-6",
      "path-7",
      "path-8",
      "path-9",
    ],
  );
});

Deno.test("endpoint planner validates every locator and reserved namespace", () => {
  assertEquals(
    make_planner().plan({
      endpoint_set: {
        canonical: endpoint("valid"),
        alternates: [endpoint("../invalid")],
      },
      supported_delivery_profiles: ["inline"],
    }),
    { ok: false, reason: "invalid_locator" },
  );
  assertEquals(
    make_planner().plan({
      endpoint_set: { canonical: endpoint("page", "inline", "SITE") },
      supported_delivery_profiles: ["inline"],
    }),
    { ok: false, reason: "forbidden_namespace" },
  );
});

Deno.test("endpoint planner keeps references independent across namespaces", () => {
  const result = make_planner().plan({
    endpoint_set: {
      canonical: endpoint("preview", "inline", "Alice"),
      alternates: [endpoint("download", "attachment", "Bob")],
    },
    supported_delivery_profiles: ["inline", "attachment"],
  });
  assert(result.ok);
  assertEquals(result.endpoint_set.alternates[0].locator.namespace, "Bob");
});

Deno.test("endpoint planner rejects case-insensitive duplicate locator claims", () => {
  assertEquals(
    make_planner().plan({
      endpoint_set: {
        canonical: endpoint("Report", "inline", "Alice"),
        alternates: [endpoint("REPORT", "attachment", "ALICE")],
      },
      supported_delivery_profiles: ["inline", "attachment"],
    }),
    { ok: false, reason: "duplicate_locator" },
  );
});

Deno.test("endpoint planner enforces content-specific delivery profiles", () => {
  assertEquals(
    make_planner().plan({
      endpoint_set: {
        canonical: endpoint("report.pdf", "attachment"),
      },
      supported_delivery_profiles: ["inline"],
    }),
    { ok: false, reason: "unsupported_delivery_profile" },
  );

  const future_profile = make_planner().plan({
    endpoint_set: {
      canonical: {
        locator: { namespace: "Alice", page_name: "stream" },
        delivery_profile: "stream",
      },
    },
    supported_delivery_profiles: ["stream"],
  });
  assert(future_profile.ok);
  assertEquals(
    future_profile.endpoint_set.canonical.delivery_profile,
    "stream",
  );
});

Deno.test("endpoint planner gives no path suffix special meaning", () => {
  assertEquals(
    make_planner().plan({
      endpoint_set: {
        canonical: endpoint("download", "attachment"),
        alternates: [endpoint("browser-copy.pdf", "inline")],
      },
      supported_delivery_profiles: ["inline", "attachment"],
    }),
    {
      ok: true,
      endpoint_set: {
        canonical: endpoint("download", "attachment"),
        alternates: [endpoint("browser-copy.pdf", "inline")],
      },
    },
  );
});

Deno.test("endpoint planner detaches accepted publisher intent", () => {
  const canonical = endpoint("Report");
  const alternate = endpoint("Download", "attachment");
  const result = make_planner().plan({
    endpoint_set: { canonical, alternates: [alternate] },
    supported_delivery_profiles: ["inline", "attachment"],
  });
  assert(result.ok);
  canonical.locator.namespace = "Changed";
  alternate.locator.page_name = "Changed";
  assertEquals(result.endpoint_set, {
    canonical: endpoint("Report"),
    alternates: [endpoint("Download", "attachment")],
  });
});

Deno.test("endpoint planner rejects invalid content profile declarations", () => {
  const planner = make_planner();
  assertThrows(
    () =>
      planner.plan({
        endpoint_set: { canonical: endpoint("page") },
        supported_delivery_profiles: [],
      }),
    Error,
    "non-empty",
  );
  assertThrows(
    () =>
      planner.plan({
        endpoint_set: { canonical: endpoint("page") },
        supported_delivery_profiles: ["inline", "inline"],
      }),
    Error,
    "valid and unique",
  );
});
