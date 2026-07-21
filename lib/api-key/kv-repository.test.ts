import { assert, assertEquals, assertRejects } from "@std/assert";
import { KvToolboxGateway } from "../storage/kv-toolbox-gateway.ts";
import type { ApiKeyRepository } from "./interfaces.ts";
import { DenoKvApiKeyRepository } from "./kv-repository.ts";
import type { ApiKeyRecord } from "./model.ts";
import { test_api_key_repository_conformance } from "./repository-conformance.ts";

const conformance_handles = new WeakMap<object, Deno.Kv>();

function gateway(kv: Deno.Kv): KvToolboxGateway {
  return new KvToolboxGateway(kv);
}

test_api_key_repository_conformance({
  name: "DenoKvApiKeyRepository",
  make_repository: async () => {
    const kv = await Deno.openKv(":memory:");
    const repository = new DenoKvApiKeyRepository(gateway(kv));
    conformance_handles.set(repository, kv);
    return repository;
  },
  teardown: (repository) => {
    conformance_handles.get(repository)?.close();
    conformance_handles.delete(repository);
  },
});

function record(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  const now = new Date("2026-07-22T12:00:00.000Z");
  return {
    api_key_id: "key-1",
    owner_user_id: "user-1",
    label: "automation",
    permissions: ["read"],
    secret_hash: "hash-1",
    created_at: now,
    updated_at: now,
    expires_at: null,
    revision: 1,
    ...overrides,
  };
}

const record_key = ["iam-pager", "api-keys", "by-id", "key-1"];

Deno.test("DenoKvApiKeyRepository: state is shared outside repository instances", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const writer: ApiKeyRepository = new DenoKvApiKeyRepository(gateway(kv));
    assert(await writer.create(record()));

    const reader: ApiKeyRepository = new DenoKvApiKeyRepository(gateway(kv));
    assertEquals(await reader.find_by_id("key-1"), record());
    assertEquals(await reader.find_by_secret_hash("hash-1"), record());
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvApiKeyRepository: malformed stored records fail closed", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository: ApiKeyRepository = new DenoKvApiKeyRepository(
      gateway(kv),
    );
    assert(await repository.create(record()));

    const stored = (await kv.get<Record<string, unknown>>(record_key)).value!;
    await kv.set(record_key, { ...stored, permissions: ["read", "root"] });
    await assertRejects(
      () => repository.find_by_id("key-1"),
      TypeError,
      "invalid stored api key record",
    );
    await assertRejects(() => repository.find_by_secret_hash("hash-1"));
    await assertRejects(() => repository.list_by_owner("user-1"));

    await kv.set(record_key, { ...stored, unexpected: true });
    await assertRejects(
      () => repository.find_by_id("key-1"),
      TypeError,
      "invalid stored api key record",
    );

    await kv.set(record_key, { ...stored, revision: 0 });
    await assertRejects(() => repository.find_by_id("key-1"), TypeError);
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvApiKeyRepository: a dangling secret index fails closed", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository: ApiKeyRepository = new DenoKvApiKeyRepository(
      gateway(kv),
    );
    await kv.set(["iam-pager", "api-keys", "by-secret-hash", "orphan"], {
      api_key_id: "missing-key",
    });
    await assertRejects(
      () => repository.find_by_secret_hash("orphan"),
      TypeError,
      "invalid stored api key record",
    );
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvApiKeyRepository: revoke_all leaves foreign owners and later creates intact", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository: ApiKeyRepository = new DenoKvApiKeyRepository(
      gateway(kv),
    );
    assert(await repository.create(record()));
    assert(
      await repository.create(record({
        api_key_id: "key-2",
        secret_hash: "hash-2",
        owner_user_id: "user-2",
      })),
    );
    assertEquals(await repository.revoke_all_by_owner("user-1"), 1);

    // The foreign owner's key stays resolvable through a fresh instance.
    const reader: ApiKeyRepository = new DenoKvApiKeyRepository(gateway(kv));
    assert(await reader.find_by_secret_hash("hash-2") !== null);

    // The revoked owner starts from a clean slate, reusing identifiers.
    assert(await reader.create(record({ label: "second life" })));
    assertEquals(
      (await reader.list_by_owner("user-1")).map((entry) => entry.label),
      ["second life"],
    );
  } finally {
    kv.close();
  }
});
