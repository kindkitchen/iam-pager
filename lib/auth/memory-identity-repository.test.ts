import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import type { UserIdGenerator } from "./interfaces.ts";
import { MemoryIdentityRepository } from "./memory-identity-repository.ts";
import type { ExternalIdentityObservation } from "./model.ts";

class SequenceUserIdGenerator implements UserIdGenerator {
  constructor(private readonly values: string[]) {}

  generate(): string {
    const value = this.values.shift();
    if (value === undefined) throw new Error("sequence exhausted");
    return value;
  }
}

function observation(
  overrides: Partial<ExternalIdentityObservation> = {},
): ExternalIdentityObservation {
  return {
    strategy_id: "google",
    provider_subject: "provider-user-1",
    email: "first@example.com",
    display_name: "First Name",
    picture_url: "https://example.com/first.png",
    observed_at: new Date("2026-07-18T10:00:00.000Z"),
    ...overrides,
  };
}

Deno.test("identity repository creates one local user and external identity", async () => {
  const repository = new MemoryIdentityRepository(
    new SequenceUserIdGenerator(["user-1"]),
  );

  const result = await repository.find_or_create(observation());

  assertEquals(result.created, true);
  assertEquals(result.user, {
    user_id: "user-1",
    created_at: new Date("2026-07-18T10:00:00.000Z"),
  });
  assertEquals(result.identity, {
    user_id: "user-1",
    strategy_id: "google",
    provider_subject: "provider-user-1",
    email: "first@example.com",
    display_name: "First Name",
    picture_url: "https://example.com/first.png",
    created_at: new Date("2026-07-18T10:00:00.000Z"),
    updated_at: new Date("2026-07-18T10:00:00.000Z"),
  });
  assertEquals(repository.user_count, 1);
  assertEquals(repository.identity_count, 1);
});

Deno.test("same strategy subject keeps its user while profile fields change", async () => {
  const repository = new MemoryIdentityRepository(
    new SequenceUserIdGenerator(["user-1"]),
  );
  const first = await repository.find_or_create(observation());
  const updated_at = new Date("2026-07-18T11:00:00.000Z");

  const second = await repository.find_or_create(observation({
    email: "changed@example.com",
    display_name: "Changed Name",
    picture_url: undefined,
    observed_at: updated_at,
  }));

  assertEquals(second.created, false);
  assertEquals(second.user, first.user);
  assertEquals(second.identity.user_id, first.identity.user_id);
  assertEquals(second.identity.email, "changed@example.com");
  assertEquals(second.identity.display_name, "Changed Name");
  assertEquals(second.identity.picture_url, undefined);
  assertEquals(second.identity.created_at, first.identity.created_at);
  assertEquals(second.identity.updated_at, updated_at);
  assertEquals(repository.user_count, 1);
});

Deno.test("equal email never links identities from different strategies", async () => {
  const repository = new MemoryIdentityRepository(
    new SequenceUserIdGenerator(["user-google", "user-other"]),
  );

  const google = await repository.find_or_create(observation());
  const other = await repository.find_or_create(observation({
    strategy_id: "other-provider",
  }));

  assertNotEquals(google.user.user_id, other.user.user_id);
  assertEquals(repository.user_count, 2);
  assertEquals(repository.identity_count, 2);
});

Deno.test("concurrent saves of one provider subject find or create once", async () => {
  const repository = new MemoryIdentityRepository(
    new SequenceUserIdGenerator(["user-1"]),
  );

  const results = await Promise.all([
    repository.find_or_create(observation()),
    repository.find_or_create(observation()),
    repository.find_or_create(observation()),
  ]);

  assertEquals(new Set(results.map((result) => result.user.user_id)).size, 1);
  assertEquals(results.filter((result) => result.created).length, 1);
  assertEquals(repository.user_count, 1);
  assertEquals(repository.identity_count, 1);
});

Deno.test("an older observation cannot roll profile fields backward", async () => {
  const repository = new MemoryIdentityRepository(
    new SequenceUserIdGenerator(["user-1"]),
  );
  const latest = await repository.find_or_create(observation({
    email: "latest@example.com",
    observed_at: new Date("2026-07-18T12:00:00.000Z"),
  }));

  const stale = await repository.find_or_create(observation({
    email: "stale@example.com",
    observed_at: new Date("2026-07-18T11:00:00.000Z"),
  }));

  assertEquals(stale.identity, latest.identity);
});

Deno.test("identity repository returns copies and rejects malformed observations", async () => {
  const repository = new MemoryIdentityRepository(
    new SequenceUserIdGenerator(["user-1"]),
  );
  const created = await repository.find_or_create(observation());
  created.user.created_at.setUTCFullYear(2000);
  created.identity.updated_at.setUTCFullYear(2000);

  const stored_user = await repository.find_user("user-1");
  const stored_identity = await repository.find_by_strategy_subject(
    "google",
    "provider-user-1",
  );
  assertExists(stored_user);
  assertExists(stored_identity);
  assertEquals(stored_user.created_at.getUTCFullYear(), 2026);
  assertEquals(stored_identity.updated_at.getUTCFullYear(), 2026);

  assertThrows(
    () => repository.find_or_create(observation({ strategy_id: "Google" })),
    TypeError,
  );
  assertThrows(
    () => repository.find_or_create(observation({ provider_subject: "" })),
    TypeError,
  );
});
