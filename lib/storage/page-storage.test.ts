import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { DenoKvPageRepository, MemoryPageRepository } from "../page/mod.ts";
import { KvToolboxGateway } from "./kv-toolbox-gateway.ts";
import {
  DefaultPageRepositoryFactory,
  PAGE_STORAGE_BACKEND_ENV,
  type PageStorageEnvironmentSource,
  parse_page_storage_config,
} from "./page-storage.ts";
import { KvPageAggregateRepository } from "./kv-page-aggregate-repository.ts";
import { migrate_pages_v1_to_v2 } from "./pages-v1-to-v2-migration.ts";
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

Deno.test("durable page profiles inherit the configured ownership KV path", () => {
  for (const backend of ["deno-kv", "deno-kv-v2"] as const) {
    assertEquals(
      parse_page_storage_config(
        environment({ [PAGE_STORAGE_BACKEND_ENV]: backend }),
        { backend: "deno-kv" },
      ),
      { backend },
    );
    assertEquals(
      parse_page_storage_config(
        environment({ [PAGE_STORAGE_BACKEND_ENV]: backend }),
        { backend: "deno-kv", path: "/data/ownership.kv" },
      ),
      { backend, path: "/data/ownership.kv" },
    );
  }
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
      `${PAGE_STORAGE_BACKEND_ENV} must be memory, deno-kv, or deno-kv-v2`,
    );
  }
  for (const backend of ["deno-kv", "deno-kv-v2"] as const) {
    assertThrows(
      () =>
        parse_page_storage_config(
          environment({ [PAGE_STORAGE_BACKEND_ENV]: backend }),
          { backend: "memory" },
        ),
      TypeError,
      "requires durable ownership",
    );
  }
});

Deno.test("v2 page selection refuses missing readiness and closes its gateway", async () => {
  const kv = await Deno.openKv(":memory:");
  const factory = new DefaultPageRepositoryFactory({
    kv_opener: {
      open: () => Promise.resolve(new KvToolboxGateway(kv)),
    },
  });

  await assertRejects(
    () => factory.create({ backend: "deno-kv-v2" }),
    Error,
    "pages-v1-to-v2 migration has not been verified",
  );
  await assertRejects(() => kv.get(["closed"]), Error);
});

Deno.test("page repository factory preserves v1 fallback and gates v2 aggregate selection", async () => {
  const kv = await Deno.openKv(":memory:");
  let opened_path: string | undefined;
  const factory = new DefaultPageRepositoryFactory({
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
    assertInstanceOf(memory, MemoryPageRepository);
    assertEquals(opened_path, undefined);

    const durable = await factory.create({
      backend: "deno-kv",
      path: "/data/ownership.kv",
    });
    assertInstanceOf(durable, DenoKvPageRepository);
    assertEquals(opened_path, "/data/ownership.kv");
    const stored = await durable.put_trial({
      page_id: "page-1",
      locator: { namespace: "Durable", page_name: "Page" },
      content: {
        content_type: "md-page",
        data: { md: "persisted", html: "<p>persisted</p>" },
        meta: { media_type: "text/html; charset=utf-8", size_bytes: 16 },
      },
      now,
    });
    assertEquals(stored.ok, true);

    const fallback = await factory.create({
      backend: "deno-kv",
      path: "/data/ownership.kv",
    });
    assertInstanceOf(fallback, DenoKvPageRepository);
    const page = await fallback.find_by_locator({
      namespace: "durable",
      page_name: "page",
    });
    assertEquals(page?.page_id, "page-1");
    assertEquals(page?.locator, { namespace: "Durable", page_name: "Page" });

    await migrate_pages_v1_to_v2(new KvToolboxGateway(kv));
    const aggregate = await factory.create({
      backend: "deno-kv-v2",
      path: "/data/ownership.kv",
    });
    assertInstanceOf(aggregate, KvPageAggregateRepository);
    assertEquals(opened_path, "/data/ownership.kv");
    const endpoint = await aggregate.resolve_page_endpoint({
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
