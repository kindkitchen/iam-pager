import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  type ApiKeyRecord,
  DenoKvApiKeyRepository,
  MemoryApiKeyRepository,
} from "../api-key/mod.ts";
import {
  API_KEY_STORAGE_BACKEND_ENV,
  type ApiKeyStorageEnvironmentSource,
  DefaultApiKeyRepositoryFactory,
  parse_api_key_storage_config,
} from "./api-key-storage.ts";
import { KvToolboxGateway } from "./kv-toolbox-gateway.ts";
import type { OwnershipStorageConfig } from "./ownership-storage.ts";

function environment(
  values: Readonly<Record<string, string>>,
): ApiKeyStorageEnvironmentSource {
  return { get: (name) => values[name] };
}

Deno.test("api key storage inherits ownership unless explicitly ephemeral", () => {
  for (
    const ownership_config of [
      { backend: "memory" },
      { backend: "deno-kv", path: "/data/ownership.kv" },
    ] as const satisfies readonly OwnershipStorageConfig[]
  ) {
    assertEquals(
      parse_api_key_storage_config(environment({}), ownership_config),
      ownership_config,
    );
    assertEquals(
      parse_api_key_storage_config(
        environment({ [API_KEY_STORAGE_BACKEND_ENV]: "memory" }),
        ownership_config,
      ),
      { backend: "memory" },
    );
  }
});

Deno.test("durable api keys inherit the configured ownership KV path", () => {
  assertEquals(
    parse_api_key_storage_config(
      environment({ [API_KEY_STORAGE_BACKEND_ENV]: "deno-kv" }),
      { backend: "deno-kv" },
    ),
    { backend: "deno-kv" },
  );
  assertEquals(
    parse_api_key_storage_config(
      environment({ [API_KEY_STORAGE_BACKEND_ENV]: "deno-kv" }),
      { backend: "deno-kv", path: "/data/ownership.kv" },
    ),
    { backend: "deno-kv", path: "/data/ownership.kv" },
  );
});

Deno.test("api key storage configuration rejects invalid or dangling durability", () => {
  for (const backend of ["", "kv", "postgres", " deno-kv"]) {
    assertThrows(
      () =>
        parse_api_key_storage_config(
          environment({ [API_KEY_STORAGE_BACKEND_ENV]: backend }),
          { backend: "deno-kv" },
        ),
      TypeError,
      `${API_KEY_STORAGE_BACKEND_ENV} must be memory or deno-kv`,
    );
  }
  assertThrows(
    () =>
      parse_api_key_storage_config(
        environment({ [API_KEY_STORAGE_BACKEND_ENV]: "deno-kv" }),
        { backend: "memory" },
      ),
    TypeError,
    "requires durable ownership",
  );
});

Deno.test("api key repository factory switches implementations and preserves records", async () => {
  const kv = await Deno.openKv(":memory:");
  let opened_path: string | undefined;
  const factory = new DefaultApiKeyRepositoryFactory({
    kv_opener: {
      open: (path) => {
        opened_path = path;
        return Promise.resolve(new KvToolboxGateway(kv));
      },
    },
  });
  const record: ApiKeyRecord = {
    api_key_id: "key-1",
    owner_user_id: "user-1",
    label: "automation",
    permissions: ["read"],
    secret_hash: "hash-1",
    created_at: new Date("2026-07-22T12:00:00.000Z"),
    updated_at: new Date("2026-07-22T12:00:00.000Z"),
    expires_at: null,
    revision: 1,
  };

  try {
    const memory = await factory.create({ backend: "memory" });
    assertInstanceOf(memory, MemoryApiKeyRepository);
    assertEquals(opened_path, undefined);

    const durable = await factory.create({
      backend: "deno-kv",
      path: "/data/ownership.kv",
    });
    assertInstanceOf(durable, DenoKvApiKeyRepository);
    assertEquals(opened_path, "/data/ownership.kv");
    assertEquals(await durable.create(record), true);

    const recomposed = await factory.create({
      backend: "deno-kv",
      path: "/data/ownership.kv",
    });
    assertEquals(await recomposed.find_by_secret_hash("hash-1"), record);
  } finally {
    kv.close();
  }
});
