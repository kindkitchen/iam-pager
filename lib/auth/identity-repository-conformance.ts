import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import type { IdentityRepository, UserIdGenerator } from "./interfaces.ts";
import type { ExternalIdentityObservation } from "./model.ts";

export interface IdentityRepositoryConformanceOptions {
  /** Implementation name used as the test-name prefix. */
  readonly name: string;
  /** Must return a fresh, empty repository for every test. */
  readonly make_repository: (
    id_generator: UserIdGenerator,
  ) => IdentityRepository | Promise<IdentityRepository>;
  /** Optional per-test cleanup (close connections, drop state). */
  readonly teardown?: (
    repository: IdentityRepository,
  ) => void | Promise<void>;
}

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

/** Registers the complete `IdentityRepository` behavior against a backend. */
export function test_identity_repository_conformance(
  options: IdentityRepositoryConformanceOptions,
): void {
  const conformance_test = (
    label: string,
    run: (repository: IdentityRepository) => Promise<void>,
    ids: string[] = ["user-1"],
  ) => {
    Deno.test(`${options.name}: ${label}`, async () => {
      const repository = await options.make_repository(
        new SequenceUserIdGenerator(ids),
      );
      try {
        await run(repository);
      } finally {
        await options.teardown?.(repository);
      }
    });
  };

  conformance_test("returns null for missing users and identities", async (
    repository,
  ) => {
    assertEquals(await repository.find_user("missing-user"), null);
    assertEquals(
      await repository.find_by_strategy_subject("google", "missing-subject"),
      null,
    );
  });

  conformance_test("creates one local user and external identity", async (
    repository,
  ) => {
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
  });

  conformance_test("keeps its user while profile fields change", async (
    repository,
  ) => {
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
  });

  conformance_test(
    "never links equal emails from different strategies",
    async (repository) => {
      const google = await repository.find_or_create(observation());
      const other = await repository.find_or_create(observation({
        strategy_id: "other-provider",
      }));

      assertNotEquals(google.user.user_id, other.user.user_id);
      assertExists(await repository.find_user(google.user.user_id));
      assertExists(await repository.find_user(other.user.user_id));
    },
    ["user-google", "user-other"],
  );

  conformance_test(
    "retries generated user ID collisions without linking identities",
    async (repository) => {
      const first = await repository.find_or_create(observation());
      const second = await repository.find_or_create(observation({
        strategy_id: "other-provider",
      }));

      assertEquals(first.user.user_id, "shared-user");
      assertEquals(second.user.user_id, "second-user");
      assertNotEquals(first.user.user_id, second.user.user_id);
    },
    ["shared-user", "shared-user", "second-user"],
  );

  conformance_test(
    "concurrent saves of one provider subject find or create once",
    async (repository) => {
      const results = await Promise.all([
        repository.find_or_create(observation()),
        repository.find_or_create(observation()),
        repository.find_or_create(observation()),
      ]);

      assertEquals(
        new Set(results.map((result) => result.user.user_id)).size,
        1,
      );
      assertEquals(results.filter((result) => result.created).length, 1);
    },
    Array.from({ length: 8 }, (_, index) => `user-${index + 1}`),
  );

  conformance_test("older observations cannot roll profile backward", async (
    repository,
  ) => {
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

  conformance_test(
    "copies mutable values and rejects malformed observations",
    async (
      repository,
    ) => {
      const input = observation();
      const pending_creation = repository.find_or_create(input);
      input.observed_at.setUTCFullYear(2000);
      const created = await pending_creation;
      assertEquals(created.user.created_at.getUTCFullYear(), 2026);
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

      await assertRejects(
        async () =>
          await repository.find_or_create(
            observation({ strategy_id: "Google" }),
          ),
        TypeError,
      );
      await assertRejects(
        async () =>
          await repository.find_or_create(
            observation({ provider_subject: "" }),
          ),
        TypeError,
      );
      await assertRejects(
        async () => await repository.find_or_create(observation({ email: "" })),
        TypeError,
      );
      await assertRejects(
        async () =>
          await repository.find_or_create(
            observation({ observed_at: new Date(Number.NaN) }),
          ),
        TypeError,
      );
    },
  );
}
