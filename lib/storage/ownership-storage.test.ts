import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  DenoKvIdentityRepository,
  MemoryIdentityRepository,
} from "../auth/mod.ts";
import {
  DenoKvNamespaceRepository,
  MemoryNamespaceRepository,
} from "../namespace/mod.ts";
import { CryptoIdGenerator } from "../session/mod.ts";
import { KvToolboxGateway } from "./kv-toolbox-gateway.ts";
import {
  DefaultOwnershipRepositoryFactory,
  OWNERSHIP_DENO_KV_PATH_ENV,
  OWNERSHIP_STORAGE_BACKEND_ENV,
  type OwnershipStorageEnvironmentSource,
  parse_ownership_storage_config,
} from "./ownership-storage.ts";

function environment(
  values: Readonly<Record<string, string>>,
): OwnershipStorageEnvironmentSource {
  return { get: (name) => values[name] };
}

Deno.test("ownership storage configuration defaults explicitly to memory", () => {
  assertEquals(parse_ownership_storage_config(environment({})), {
    backend: "memory",
  });
  assertEquals(
    parse_ownership_storage_config(
      environment({ [OWNERSHIP_STORAGE_BACKEND_ENV]: "memory" }),
    ),
    { backend: "memory" },
  );
});

Deno.test("ownership storage configuration selects Deno KV with an optional path", () => {
  assertEquals(
    parse_ownership_storage_config(
      environment({ [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv" }),
    ),
    { backend: "deno-kv" },
  );
  assertEquals(
    parse_ownership_storage_config(environment({
      [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
      [OWNERSHIP_DENO_KV_PATH_ENV]: "/data/iam-pager.kv",
    })),
    { backend: "deno-kv", path: "/data/iam-pager.kv" },
  );
});

Deno.test("ownership storage configuration rejects invalid or ignored values", () => {
  for (const backend of ["", "kv", "postgres", " deno-kv"] as const) {
    assertThrows(
      () =>
        parse_ownership_storage_config(
          environment({ [OWNERSHIP_STORAGE_BACKEND_ENV]: backend }),
        ),
      TypeError,
      `${OWNERSHIP_STORAGE_BACKEND_ENV} must be memory or deno-kv`,
    );
  }

  const ignored_path_configs: Readonly<Record<string, string>>[] = [
    { [OWNERSHIP_DENO_KV_PATH_ENV]: "/data/ignored.kv" },
    {
      [OWNERSHIP_STORAGE_BACKEND_ENV]: "memory",
      [OWNERSHIP_DENO_KV_PATH_ENV]: "/data/ignored.kv",
    },
  ];
  for (const values of ignored_path_configs) {
    assertThrows(
      () => parse_ownership_storage_config(environment(values)),
      TypeError,
      `${OWNERSHIP_DENO_KV_PATH_ENV} requires`,
    );
  }

  for (
    const path of [
      "",
      " /data/padded.kv",
      "/data/padded.kv ",
      "x".repeat(4097),
    ]
  ) {
    assertThrows(
      () =>
        parse_ownership_storage_config(environment({
          [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
          [OWNERSHIP_DENO_KV_PATH_ENV]: path,
        })),
      TypeError,
      `${OWNERSHIP_DENO_KV_PATH_ENV} must be`,
    );
  }
});

Deno.test("ownership repository factory switches linked implementations together", async () => {
  const kv = await Deno.openKv(":memory:");
  let opened_path: string | undefined;
  const factory = new DefaultOwnershipRepositoryFactory({
    kv_opener: {
      open: (path) => {
        opened_path = path;
        return Promise.resolve(new KvToolboxGateway(kv));
      },
    },
  });
  const dependencies = { user_id_generator: new CryptoIdGenerator() };

  try {
    const memory = await factory.create({ backend: "memory" }, dependencies);
    assertInstanceOf(
      memory.identity_repository,
      MemoryIdentityRepository,
    );
    assertInstanceOf(
      memory.namespace_repository,
      MemoryNamespaceRepository,
    );
    assertEquals(opened_path, undefined);

    const durable = await factory.create(
      { backend: "deno-kv", path: "/data/ownership.kv" },
      dependencies,
    );
    assertInstanceOf(
      durable.identity_repository,
      DenoKvIdentityRepository,
    );
    assertInstanceOf(
      durable.namespace_repository,
      DenoKvNamespaceRepository,
    );
    assertEquals(opened_path, "/data/ownership.kv");

    const identity = await durable.identity_repository.find_or_create({
      strategy_id: "google",
      provider_subject: "provider-user",
      email: "person@example.com",
      observed_at: new Date("2026-07-18T00:00:00.000Z"),
    });
    await durable.namespace_repository.reserve({
      namespace: "Owned",
      owner_user_id: identity.user.user_id,
    });

    const recomposed = await factory.create(
      { backend: "deno-kv", path: "/data/ownership.kv" },
      dependencies,
    );
    assertEquals(
      (await recomposed.identity_repository.find_by_strategy_subject(
        "google",
        "provider-user",
      ))?.user_id,
      identity.user.user_id,
    );
    assertEquals(
      (await recomposed.namespace_repository.find("owned"))?.owner_user_id,
      identity.user.user_id,
    );
  } finally {
    kv.close();
  }
});
