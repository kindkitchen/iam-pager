import { assertEquals } from "@std/assert";
import type { UserIdGenerator } from "./interfaces.ts";
import { test_identity_repository_conformance } from "./identity-repository-conformance.ts";
import { MemoryIdentityRepository } from "./memory-identity-repository.ts";

class SequenceUserIdGenerator implements UserIdGenerator {
  readonly #values: string[];

  constructor(values: string[]) {
    this.#values = values;
  }

  generate(): string {
    const value = this.#values.shift();
    if (value === undefined) throw new Error("sequence exhausted");
    return value;
  }
}

test_identity_repository_conformance({
  name: "MemoryIdentityRepository",
  make_repository: (id_generator) => new MemoryIdentityRepository(id_generator),
});

Deno.test("MemoryIdentityRepository: reports process-local record counts", async () => {
  const repository = new MemoryIdentityRepository(
    new SequenceUserIdGenerator(["user-google", "user-other"]),
  );
  const base = {
    provider_subject: "provider-user-1",
    email: "person@example.com",
    observed_at: new Date("2026-07-18T00:00:00.000Z"),
  };

  await repository.find_or_create({ strategy_id: "google", ...base });
  await repository.find_or_create({ strategy_id: "other-provider", ...base });

  assertEquals(repository.user_count, 2);
  assertEquals(repository.identity_count, 2);
});
