import { assert, assertEquals } from "@std/assert";
import { MemoryApiKeyRepository } from "./memory-repository.ts";
import type { ApiKeyRecord } from "./model.ts";

const now = new Date("2026-07-22T12:00:00.000Z");

function record(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
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

Deno.test("create refuses ID and secret-hash collisions", async () => {
  const repository = new MemoryApiKeyRepository();
  assert(await repository.create(record()));
  assert(!await repository.create(record({ secret_hash: "hash-2" })));
  assert(
    !await repository.create(record({ api_key_id: "key-2" })),
  );
  assert(
    await repository.create(
      record({ api_key_id: "key-2", secret_hash: "hash-2" }),
    ),
  );
});

Deno.test("lookups return copies, not shared state", async () => {
  const repository = new MemoryApiKeyRepository();
  await repository.create(record());
  const first = await repository.find_by_id("key-1");
  assert(first !== null);
  first.created_at.setFullYear(1999);
  const second = await repository.find_by_secret_hash("hash-1");
  assert(second !== null);
  assertEquals(second.created_at, now);
});

Deno.test("update enforces owner and revision, then increments", async () => {
  const repository = new MemoryApiKeyRepository();
  await repository.create(record());
  const foreign = await repository.update({
    api_key_id: "key-1",
    owner_user_id: "user-2",
    expected_revision: 1,
    label: "x",
    permissions: ["read"],
    expires_at: null,
    updated_at: now,
  });
  assert(!foreign.ok && foreign.reason === "not_found");
  const stale = await repository.update({
    api_key_id: "key-1",
    owner_user_id: "user-1",
    expected_revision: 2,
    label: "x",
    permissions: ["read"],
    expires_at: null,
    updated_at: now,
  });
  assert(!stale.ok && stale.reason === "stale_revision");
  const updated = await repository.update({
    api_key_id: "key-1",
    owner_user_id: "user-1",
    expected_revision: 1,
    label: "renamed",
    permissions: ["read", "delete"],
    expires_at: null,
    updated_at: now,
  });
  assert(updated.ok);
  assertEquals(updated.record.revision, 2);
  assertEquals(updated.record.label, "renamed");
});

Deno.test("revoke removes the secret-hash lookup atomically", async () => {
  const repository = new MemoryApiKeyRepository();
  await repository.create(record());
  const revoked = await repository.revoke("key-1", "user-1", 1);
  assert(revoked.ok);
  assertEquals(await repository.find_by_id("key-1"), null);
  assertEquals(await repository.find_by_secret_hash("hash-1"), null);
  assert(
    await repository.create(record()),
    "revoked identifiers are free again",
  );
});

Deno.test("revoke_all_by_owner touches only that owner", async () => {
  const repository = new MemoryApiKeyRepository();
  await repository.create(record());
  await repository.create(
    record({ api_key_id: "key-2", secret_hash: "hash-2" }),
  );
  await repository.create(
    record({
      api_key_id: "key-3",
      secret_hash: "hash-3",
      owner_user_id: "user-2",
    }),
  );
  assertEquals(await repository.revoke_all_by_owner("user-1"), 2);
  assertEquals(await repository.list_by_owner("user-1"), []);
  assertEquals((await repository.list_by_owner("user-2")).length, 1);
  assertEquals(await repository.find_by_secret_hash("hash-1"), null);
});
