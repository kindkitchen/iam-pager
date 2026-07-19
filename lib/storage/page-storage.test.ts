import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { DenoKvPageRepository, MemoryPageRepository } from "../page/mod.ts";
import {
  DefaultPageRepositoryFactory,
  PAGE_STORAGE_BACKEND_ENV,
  type PageStorageEnvironmentSource,
  parse_page_storage_config,
} from "./page-storage.ts";
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
  assertEquals(
    parse_page_storage_config(
      environment({ [PAGE_STORAGE_BACKEND_ENV]: "deno-kv" }),
      { backend: "deno-kv" },
    ),
    { backend: "deno-kv" },
  );
  assertEquals(
    parse_page_storage_config(
      environment({ [PAGE_STORAGE_BACKEND_ENV]: "deno-kv" }),
      { backend: "deno-kv", path: "/data/ownership.kv" },
    ),
    { backend: "deno-kv", path: "/data/ownership.kv" },
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
});

Deno.test("page repository factory switches implementations and preserves pages", async () => {
  const kv = await Deno.openKv(":memory:");
  let opened_path: string | undefined;
  const factory = new DefaultPageRepositoryFactory({
    kv_opener: {
      open: (path) => {
        opened_path = path;
        return Promise.resolve(kv);
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

    const recomposed = await factory.create({
      backend: "deno-kv",
      path: "/data/ownership.kv",
    });
    const page = await recomposed.find_by_locator({
      namespace: "durable",
      page_name: "page",
    });
    assertEquals(page?.page_id, "page-1");
    assertEquals(page?.locator, { namespace: "Durable", page_name: "Page" });
  } finally {
    kv.close();
  }
});
