import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  DenoKvContentRepository,
  MemoryContentRepository,
  type PageRecord,
} from "../content/mod.ts";
import {
  CONTENT_STORAGE_BACKEND_ENV,
  type ContentStorageEnvironmentSource,
  DefaultContentRepositoryFactory,
  parse_content_storage_config,
} from "./content-storage.ts";
import type { OwnershipStorageConfig } from "./ownership-storage.ts";

function environment(
  values: Readonly<Record<string, string>>,
): ContentStorageEnvironmentSource {
  return { get: (name) => values[name] };
}

Deno.test("content storage configuration defaults explicitly to memory", () => {
  for (
    const ownership_config of [
      { backend: "memory" },
      { backend: "deno-kv", path: "/data/ownership.kv" },
    ] as const satisfies readonly OwnershipStorageConfig[]
  ) {
    assertEquals(
      parse_content_storage_config(environment({}), ownership_config),
      { backend: "memory" },
    );
    assertEquals(
      parse_content_storage_config(
        environment({ [CONTENT_STORAGE_BACKEND_ENV]: "memory" }),
        ownership_config,
      ),
      { backend: "memory" },
    );
  }
});

Deno.test("durable content inherits the configured ownership KV path", () => {
  assertEquals(
    parse_content_storage_config(
      environment({ [CONTENT_STORAGE_BACKEND_ENV]: "deno-kv" }),
      { backend: "deno-kv" },
    ),
    { backend: "deno-kv" },
  );
  assertEquals(
    parse_content_storage_config(
      environment({ [CONTENT_STORAGE_BACKEND_ENV]: "deno-kv" }),
      { backend: "deno-kv", path: "/data/ownership.kv" },
    ),
    { backend: "deno-kv", path: "/data/ownership.kv" },
  );
});

Deno.test("content storage configuration rejects invalid or dangling durability", () => {
  for (const backend of ["", "kv", "postgres", " deno-kv"]) {
    assertThrows(
      () =>
        parse_content_storage_config(
          environment({ [CONTENT_STORAGE_BACKEND_ENV]: backend }),
          { backend: "deno-kv" },
        ),
      TypeError,
      `${CONTENT_STORAGE_BACKEND_ENV} must be memory or deno-kv`,
    );
  }
  assertThrows(
    () =>
      parse_content_storage_config(
        environment({ [CONTENT_STORAGE_BACKEND_ENV]: "deno-kv" }),
        { backend: "memory" },
      ),
    TypeError,
    "requires durable ownership",
  );
});

Deno.test("content repository factory switches implementations and preserves pages", async () => {
  const kv = await Deno.openKv(":memory:");
  let opened_path: string | undefined;
  const factory = new DefaultContentRepositoryFactory({
    kv_opener: {
      open: (path) => {
        opened_path = path;
        return Promise.resolve(kv);
      },
    },
  });
  const page: PageRecord = {
    locator: { namespace: "Durable", page_name: "Page" },
    content: {
      content_type: "md-page",
      data: { md: "persisted", html: "<p>persisted</p>" },
      meta: { media_type: "text/html; charset=utf-8", size_bytes: 9 },
      created_at: new Date("2026-07-18T00:00:00.000Z"),
      updated_at: new Date("2026-07-18T00:00:00.000Z"),
    },
  };

  try {
    const memory = await factory.create({ backend: "memory" });
    assertInstanceOf(memory, MemoryContentRepository);
    assertEquals(opened_path, undefined);

    const durable = await factory.create({
      backend: "deno-kv",
      path: "/data/ownership.kv",
    });
    assertInstanceOf(durable, DenoKvContentRepository);
    assertEquals(opened_path, "/data/ownership.kv");
    await durable.put(page);

    const recomposed = await factory.create({
      backend: "deno-kv",
      path: "/data/ownership.kv",
    });
    assertEquals(
      await recomposed.get({ namespace: "durable", page_name: "page" }),
      page,
    );
  } finally {
    kv.close();
  }
});
