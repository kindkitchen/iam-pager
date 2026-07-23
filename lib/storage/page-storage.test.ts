import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { MemoryPageAggregateRepository } from "../page/mod.ts";
import { KvToolboxGateway } from "./kv-toolbox-gateway.ts";
import {
  DefaultPageAggregateRepositoryFactory,
  LEGACY_PAGE_STORAGE_BACKEND_ENV,
  PAGE_STORAGE_BACKEND_ENV,
  type PageStorageEnvironmentSource,
  parse_page_storage_config,
} from "./page-storage.ts";
import { KvPageAggregateRepository } from "./kv-page-aggregate-repository.ts";
import type { OwnershipStorageConfig } from "./ownership-storage.ts";

function environment(
  values: Readonly<Record<string, string>>,
): PageStorageEnvironmentSource {
  return { get: (name) => values[name] };
}

Deno.test("page storage configuration defaults explicitly to memory", () => {
  for (
    const ownership_config of [
      { backend: "memory" },
      { backend: "deno-kv", path: "/data/ownership.kv" },
    ] as const satisfies readonly OwnershipStorageConfig[]
  ) {
    assertEquals(parse_page_storage_config(environment({}), ownership_config), {
      backend: "memory",
    });
    assertEquals(
      parse_page_storage_config(
        environment({ [PAGE_STORAGE_BACKEND_ENV]: "memory" }),
        ownership_config,
      ),
      { backend: "memory" },
    );
  }
});

Deno.test("durable pages inherit the configured ownership KV path", () => {
  for (
    const selector of [
      PAGE_STORAGE_BACKEND_ENV,
      LEGACY_PAGE_STORAGE_BACKEND_ENV,
    ]
  ) {
    assertEquals(
      parse_page_storage_config(
        environment({ [selector]: "deno-kv" }),
        { backend: "deno-kv" },
      ),
      { backend: "deno-kv" },
    );
    assertEquals(
      parse_page_storage_config(
        environment({ [selector]: "deno-kv" }),
        { backend: "deno-kv", path: "/data/ownership.kv" },
      ),
      { backend: "deno-kv", path: "/data/ownership.kv" },
    );
  }
  assertEquals(
    parse_page_storage_config(
      environment({
        [PAGE_STORAGE_BACKEND_ENV]: "deno-kv",
        [LEGACY_PAGE_STORAGE_BACKEND_ENV]: "deno-kv",
      }),
      { backend: "deno-kv" },
    ),
    { backend: "deno-kv" },
  );
});

Deno.test("page storage configuration rejects invalid or dangling durability", () => {
  for (const backend of ["", "kv", "postgres", " deno-kv"]) {
    assertThrows(
      () =>
        parse_page_storage_config(
          environment({ [PAGE_STORAGE_BACKEND_ENV]: backend }),
          { backend: "deno-kv" },
        ),
      TypeError,
      `${PAGE_STORAGE_BACKEND_ENV} must be memory or deno-kv`,
    );
  }
  assertThrows(
    () =>
      parse_page_storage_config(
        environment({ [PAGE_STORAGE_BACKEND_ENV]: "deno-kv" }),
        { backend: "memory" },
      ),
    TypeError,
    "requires durable ownership",
  );
  assertThrows(
    () =>
      parse_page_storage_config(
        environment({
          [PAGE_STORAGE_BACKEND_ENV]: "deno-kv",
          [LEGACY_PAGE_STORAGE_BACKEND_ENV]: "memory",
        }),
        { backend: "deno-kv" },
      ),
    TypeError,
    "must match when both are set",
  );
});

Deno.test("page repository factory selects current memory and Deno KV aggregates", async () => {
  const kv = await Deno.openKv(":memory:");
  let opened_path: string | undefined;
  const factory = new DefaultPageAggregateRepositoryFactory({
    kv_opener: {
      open: (path) => {
        opened_path = path;
        return Promise.resolve(new KvToolboxGateway(kv));
      },
    },
  });
  const now = new Date("2026-07-19T00:00:00.000Z");

  try {
    const memory = await factory.create({ backend: "memory" });
    assertInstanceOf(memory, MemoryPageAggregateRepository);
    assertEquals(opened_path, undefined);

    const durable = await factory.create({
      backend: "deno-kv",
      path: "/data/ownership.kv",
    });
    assertInstanceOf(durable, KvPageAggregateRepository);
    assertEquals(opened_path, "/data/ownership.kv");
    const asset = await durable.create_content_asset({
      content_asset_id: "asset-1",
      content_type: "md-page",
      source: { kind: "inline" },
      data: { md: "persisted", html: "<p>persisted</p>" },
      meta: { media_type: "text/html; charset=utf-8", size_bytes: 16 },
      created_at: now,
    });
    assertEquals(asset.ok, true);
    const stored = await durable.put_trial_page_aggregate({
      page_id: "page-1",
      endpoint_set: {
        canonical: {
          locator: { namespace: "Durable", page_name: "Page" },
          delivery_profile: "inline",
        },
        alternates: [],
      },
      content_asset_id: "asset-1",
      now,
    });
    assertEquals(stored.ok, true);

    const reader = await factory.create({ backend: "deno-kv" });
    assertInstanceOf(reader, KvPageAggregateRepository);
    const endpoint = await reader.resolve_page_endpoint({
      namespace: "durable",
      page_name: "page",
    });
    assertEquals(endpoint?.page.page_id, "page-1");
    assertEquals(endpoint?.endpoint, {
      locator: { namespace: "Durable", page_name: "Page" },
      delivery_profile: "inline",
    });
  } finally {
    kv.close();
  }
});
