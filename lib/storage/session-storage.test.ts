import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  DenoKvSessionRepository,
  MemorySessionRepository,
  type SessionRecord,
} from "../session/mod.ts";
import { KvToolboxGateway } from "./kv-toolbox-gateway.ts";
import type { OwnershipStorageConfig } from "./ownership-storage.ts";
import {
  DefaultSessionRepositoryFactory,
  parse_session_storage_config,
  SESSION_STORAGE_BACKEND_ENV,
  type SessionStorageEnvironmentSource,
} from "./session-storage.ts";

function environment(
  values: Readonly<Record<string, string>>,
): SessionStorageEnvironmentSource {
  return { get: (name) => values[name] };
}

Deno.test("session storage configuration defaults explicitly to memory", () => {
  for (
    const ownership_config of [
      { backend: "memory" },
      { backend: "deno-kv", path: "/data/ownership.kv" },
    ] as const satisfies readonly OwnershipStorageConfig[]
  ) {
    assertEquals(
      parse_session_storage_config(environment({}), ownership_config),
      { backend: "memory" },
    );
    assertEquals(
      parse_session_storage_config(
        environment({ [SESSION_STORAGE_BACKEND_ENV]: "memory" }),
        ownership_config,
      ),
      { backend: "memory" },
    );
  }
});

Deno.test("durable sessions inherit the configured ownership KV path", () => {
  assertEquals(
    parse_session_storage_config(
      environment({ [SESSION_STORAGE_BACKEND_ENV]: "deno-kv" }),
      { backend: "deno-kv" },
    ),
    { backend: "deno-kv" },
  );
  assertEquals(
    parse_session_storage_config(
      environment({ [SESSION_STORAGE_BACKEND_ENV]: "deno-kv" }),
      { backend: "deno-kv", path: "/data/ownership.kv" },
    ),
    { backend: "deno-kv", path: "/data/ownership.kv" },
  );
});

Deno.test("session storage configuration rejects invalid or dangling durability", () => {
  for (const backend of ["", "kv", "postgres", " deno-kv"]) {
    assertThrows(
      () =>
        parse_session_storage_config(
          environment({ [SESSION_STORAGE_BACKEND_ENV]: backend }),
          { backend: "deno-kv" },
        ),
      TypeError,
      `${SESSION_STORAGE_BACKEND_ENV} must be memory or deno-kv`,
    );
  }
  assertThrows(
    () =>
      parse_session_storage_config(
        environment({ [SESSION_STORAGE_BACKEND_ENV]: "deno-kv" }),
        { backend: "memory" },
      ),
    TypeError,
    "requires durable ownership",
  );
});

Deno.test("session repository factory switches implementations and preserves records", async () => {
  const kv = await Deno.openKv(":memory:");
  let opened_path: string | undefined;
  const factory = new DefaultSessionRepositoryFactory({
    kv_opener: {
      open: (path) => {
        opened_path = path;
        return Promise.resolve(new KvToolboxGateway(kv));
      },
    },
  });
  const record: SessionRecord = {
    kind: "guest",
    session_id: "session-1",
    session_version: 1,
    created_at: new Date("2026-07-18T00:00:00.000Z"),
    last_seen_at: new Date("2026-07-18T00:00:00.000Z"),
    absolute_expires_at: new Date("2026-07-25T00:00:00.000Z"),
    credential_hash: "credential-hash",
    revoked_at: null,
    authentication_attempts: [],
  };

  try {
    const memory = await factory.create({ backend: "memory" });
    assertInstanceOf(memory, MemorySessionRepository);
    assertEquals(opened_path, undefined);

    const durable = await factory.create({
      backend: "deno-kv",
      path: "/data/ownership.kv",
    });
    assertInstanceOf(durable, DenoKvSessionRepository);
    assertEquals(opened_path, "/data/ownership.kv");
    assertEquals(await durable.create(record), true);

    const recomposed = await factory.create({
      backend: "deno-kv",
      path: "/data/ownership.kv",
    });
    assertEquals(
      await recomposed.find_by_credential_hash("credential-hash"),
      record,
    );
  } finally {
    kv.close();
  }
});
