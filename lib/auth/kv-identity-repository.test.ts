import { assertEquals, assertRejects } from "@std/assert";
import type { IdentityRepository, UserIdGenerator } from "./interfaces.ts";
import { test_identity_repository_conformance } from "./identity-repository-conformance.ts";
import { DenoKvIdentityRepository } from "./kv-identity-repository.ts";

const conformance_handles = new WeakMap<object, Deno.Kv>();

test_identity_repository_conformance({
  name: "DenoKvIdentityRepository",
  make_repository: async (id_generator) => {
    const kv = await Deno.openKv(":memory:");
    const repository = new DenoKvIdentityRepository(kv, id_generator);
    conformance_handles.set(repository, kv);
    return repository;
  },
  teardown: (repository) => {
    conformance_handles.get(repository)?.close();
    conformance_handles.delete(repository);
  },
});

class FixedUserIdGenerator implements UserIdGenerator {
  generate(): string {
    return "stable-user";
  }
}

Deno.test("DenoKvIdentityRepository: state is shared outside repository instances", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const writer: IdentityRepository = new DenoKvIdentityRepository(
      kv,
      new FixedUserIdGenerator(),
    );
    const created = await writer.find_or_create({
      strategy_id: "google",
      provider_subject: "provider-user",
      email: "person@example.com",
      observed_at: new Date("2026-07-18T00:00:00.000Z"),
    });

    const reader: IdentityRepository = new DenoKvIdentityRepository(
      kv,
      new FixedUserIdGenerator(),
    );
    assertEquals(
      await reader.find_by_strategy_subject("google", "provider-user"),
      created.identity,
    );
    assertEquals(await reader.find_user(created.user.user_id), created.user);
    const storage_key = [
      "iam-pager",
      "identities",
      "by-provider",
      "google",
      "provider-user",
    ];
    const stored_identity = {
      schema_version: 1,
      user_id: "stable-user",
      strategy_id: "google",
      provider_subject: "provider-user",
      email: "person@example.com",
      created_at: "2026-07-18T00:00:00.000Z",
      updated_at: "2026-07-18T00:00:00.000Z",
    };
    assertEquals((await kv.get(storage_key)).value, stored_identity);

    await kv.set(storage_key, {
      ...stored_identity,
      provider_subject: "wrong-subject",
    });
    await assertRejects(
      () => reader.find_by_strategy_subject("google", "provider-user"),
      Error,
      "identity repository invariant violated",
    );
  } finally {
    kv.close();
  }
});
