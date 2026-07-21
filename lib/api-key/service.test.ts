import { assert, assertEquals, assertRejects } from "@std/assert";
import { hash_api_key_bearer } from "./generators.ts";
import type { SecretGenerator } from "./interfaces.ts";
import { MemoryApiKeyRepository } from "./memory-repository.ts";
import { ApiKeyService } from "./service.ts";

const start = new Date("2026-07-22T12:00:00.000Z");

class FakeClock {
  now_value = new Date(start);
  now(): Date {
    return new Date(this.now_value);
  }
}

class SequenceIdGenerator {
  #next = 0;
  readonly values: string[] = [];
  generate(): string {
    const value = `key-${++this.#next}`;
    this.values.push(value);
    return value;
  }
}

class SequenceSecretGenerator implements SecretGenerator {
  #next = 0;
  generate(): string {
    return String(++this.#next).padStart(43, "0");
  }
}

function make_service(overrides: {
  repository?: MemoryApiKeyRepository;
  secret_generator?: SecretGenerator;
} = {}) {
  const repository = overrides.repository ?? new MemoryApiKeyRepository();
  const clock = new FakeClock();
  const service = new ApiKeyService({
    repository,
    clock,
    id_generator: new SequenceIdGenerator(),
    secret_generator: overrides.secret_generator ??
      new SequenceSecretGenerator(),
  });
  return { service, repository, clock };
}

const future = new Date("2026-08-01T00:00:00.000Z");

Deno.test("create returns the bearer once and stores only its hash", async () => {
  const { service, repository } = make_service();
  const result = await service.create({
    owner_user_id: "user-1",
    label: "ci",
    permissions: ["all"],
    expires_at: null,
  });
  assert(result.ok);
  assert(result.bearer.startsWith("iamp_"));
  assertEquals(result.api_key.permissions, ["read", "write", "delete"]);
  assertEquals(result.api_key.status, "active");
  assertEquals(result.api_key.revision, 1);

  const stored = await repository.find_by_id(result.api_key.api_key_id);
  assert(stored !== null);
  assertEquals(stored.secret_hash, await hash_api_key_bearer(result.bearer));
  assert(!stored.secret_hash.includes(result.bearer));

  const inspected = await service.inspect("user-1", result.api_key.api_key_id);
  assert(inspected !== null);
  assert(!("bearer" in inspected));
});

Deno.test("create rejects invalid label, permissions, and expiry", async () => {
  const { service, clock } = make_service();
  const base = {
    owner_user_id: "user-1",
    label: "ok",
    permissions: ["read"],
    expires_at: null,
  };
  const invalid_label = await service.create({ ...base, label: "" });
  assert(!invalid_label.ok && invalid_label.reason === "invalid_label");
  const invalid_permissions = await service.create({
    ...base,
    permissions: ["admin"],
  });
  assert(
    !invalid_permissions.ok &&
      invalid_permissions.reason === "invalid_permissions",
  );
  const past = await service.create({
    ...base,
    expires_at: new Date("2020-01-01T00:00:00.000Z"),
  });
  assert(!past.ok && past.reason === "invalid_expiry");
  const boundary = await service.create({ ...base, expires_at: clock.now() });
  assert(!boundary.ok && boundary.reason === "invalid_expiry");
});

Deno.test("create retries ID collisions and gives up after the budget", async () => {
  const { service } = make_service();
  const first = await service.create({
    owner_user_id: "user-1",
    label: "first",
    permissions: ["read"],
    expires_at: null,
  });
  assert(first.ok);

  const colliding = new ApiKeyService({
    repository: new MemoryApiKeyRepository(),
    clock: new FakeClock(),
    id_generator: { generate: () => "fixed" },
    secret_generator: { generate: () => "0".repeat(43) },
  });
  const winner = await colliding.create({
    owner_user_id: "user-1",
    label: "a",
    permissions: ["read"],
    expires_at: null,
  });
  assert(winner.ok);
  await assertRejects(
    () =>
      colliding.create({
        owner_user_id: "user-1",
        label: "b",
        permissions: ["read"],
        expires_at: null,
      }),
    Error,
    "unique",
  );
});

Deno.test("owner isolation hides foreign keys from inspect and list", async () => {
  const { service } = make_service();
  const created = await service.create({
    owner_user_id: "user-1",
    label: "mine",
    permissions: ["read"],
    expires_at: null,
  });
  assert(created.ok);
  assertEquals(
    await service.inspect("user-2", created.api_key.api_key_id),
    null,
  );
  assertEquals(await service.list_owned("user-2"), []);
  const revoked = await service.revoke("user-2", created.api_key.api_key_id, 1);
  assert(!revoked.ok && revoked.reason === "not_found");
});

Deno.test("update is revision-bound and re-validates input", async () => {
  const { service } = make_service();
  const created = await service.create({
    owner_user_id: "user-1",
    label: "before",
    permissions: ["read"],
    expires_at: null,
  });
  assert(created.ok);
  const id = created.api_key.api_key_id;

  const updated = await service.update({
    owner_user_id: "user-1",
    api_key_id: id,
    expected_revision: 1,
    label: "after",
    permissions: ["all"],
    expires_at: future,
  });
  assert(updated.ok);
  assertEquals(updated.api_key.label, "after");
  assertEquals(updated.api_key.permissions, ["read", "write", "delete"]);
  assertEquals(updated.api_key.revision, 2);

  const stale = await service.update({
    owner_user_id: "user-1",
    api_key_id: id,
    expected_revision: 1,
    label: "again",
    permissions: ["read"],
    expires_at: null,
  });
  assert(!stale.ok && stale.reason === "stale_revision");

  const invalid = await service.update({
    owner_user_id: "user-1",
    api_key_id: id,
    expected_revision: 2,
    label: "",
    permissions: ["read"],
    expires_at: null,
  });
  assert(!invalid.ok && invalid.reason === "invalid_label");

  const foreign = await service.update({
    owner_user_id: "user-2",
    api_key_id: id,
    expected_revision: 2,
    label: "theft",
    permissions: ["read"],
    expires_at: null,
  });
  assert(!foreign.ok && foreign.reason === "not_found");
});

Deno.test("resolve_bearer authenticates only well-formed active keys", async () => {
  const { service, clock } = make_service();
  const created = await service.create({
    owner_user_id: "user-1",
    label: "ci",
    permissions: ["read", "write"],
    expires_at: future,
  });
  assert(created.ok);

  const principal = await service.resolve_bearer(created.bearer);
  assert(principal !== null);
  assertEquals(principal.kind, "api_key");
  assertEquals(principal.user_id, "user-1");
  assertEquals(principal.api_key_id, created.api_key.api_key_id);
  assertEquals(principal.permissions, ["read", "write"]);

  assertEquals(await service.resolve_bearer("not-a-bearer"), null);
  assertEquals(
    await service.resolve_bearer(`iamp_${"x".repeat(43)}`),
    null,
  );

  clock.now_value = new Date(future);
  assertEquals(await service.resolve_bearer(created.bearer), null);
});

Deno.test("individual revoke invalidates the bearer immediately", async () => {
  const { service } = make_service();
  const created = await service.create({
    owner_user_id: "user-1",
    label: "ci",
    permissions: ["read"],
    expires_at: null,
  });
  assert(created.ok);
  const stale = await service.revoke("user-1", created.api_key.api_key_id, 9);
  assert(!stale.ok && stale.reason === "stale_revision");
  const revoked = await service.revoke("user-1", created.api_key.api_key_id, 1);
  assert(revoked.ok);
  assertEquals(await service.resolve_bearer(created.bearer), null);
  assertEquals(
    await service.inspect("user-1", created.api_key.api_key_id),
    null,
  );
});

Deno.test("revoke_all removes every owner key including the calling key", async () => {
  const { service } = make_service();
  const bearers: string[] = [];
  for (const label of ["one", "two", "three"]) {
    const created = await service.create({
      owner_user_id: "user-1",
      label,
      permissions: ["all"],
      expires_at: null,
    });
    assert(created.ok);
    bearers.push(created.bearer);
  }
  const other = await service.create({
    owner_user_id: "user-2",
    label: "keep",
    permissions: ["read"],
    expires_at: null,
  });
  assert(other.ok);

  const result = await service.revoke_all("user-1");
  assertEquals(result.revoked_count, 3);
  for (const bearer of bearers) {
    assertEquals(await service.resolve_bearer(bearer), null);
  }
  assertEquals(await service.list_owned("user-1"), []);
  assert(await service.resolve_bearer(other.bearer) !== null);
  assertEquals((await service.revoke_all("user-1")).revoked_count, 0);
});

Deno.test("expired keys stay listed and manageable but cannot authenticate", async () => {
  const { service, clock } = make_service();
  const created = await service.create({
    owner_user_id: "user-1",
    label: "short",
    permissions: ["read"],
    expires_at: future,
  });
  assert(created.ok);
  clock.now_value = new Date("2026-09-01T00:00:00.000Z");
  const listed = await service.list_owned("user-1");
  assertEquals(listed.length, 1);
  assertEquals(listed[0].status, "expired");
  assertEquals(await service.resolve_bearer(created.bearer), null);
  const revoked = await service.revoke("user-1", created.api_key.api_key_id, 1);
  assert(revoked.ok);
});
