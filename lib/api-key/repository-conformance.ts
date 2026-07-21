import { assert, assertEquals } from "@std/assert";
import type { ApiKeyRepository } from "./interfaces.ts";
import type { ApiKeyPermission, ApiKeyRecord } from "./model.ts";

export interface ApiKeyRepositoryConformanceOptions {
  /** Implementation name used as the test-name prefix. */
  readonly name: string;
  /** Must return a fresh, empty repository for every test. */
  readonly make_repository: () =>
    | ApiKeyRepository
    | Promise<ApiKeyRepository>;
  /** Optional per-test cleanup (close connections, drop state). */
  readonly teardown?: (repository: ApiKeyRepository) => void | Promise<void>;
}

const created_at = new Date("2026-07-22T12:00:00.000Z");

function record(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    api_key_id: "key-1",
    owner_user_id: "user-1",
    label: "automation",
    permissions: ["read"],
    secret_hash: "hash-1",
    created_at: new Date(created_at),
    updated_at: new Date(created_at),
    expires_at: null,
    revision: 1,
    ...overrides,
  };
}

/** Registers the complete `ApiKeyRepository` behavior against a backend. */
export function test_api_key_repository_conformance(
  options: ApiKeyRepositoryConformanceOptions,
): void {
  const conformance_test = (
    label: string,
    run: (repository: ApiKeyRepository) => Promise<void>,
  ) => {
    Deno.test(`${options.name}: ${label}`, async () => {
      const repository = await options.make_repository();
      try {
        await run(repository);
      } finally {
        await options.teardown?.(repository);
      }
    });
  };

  conformance_test(
    "returns null and empty lists for unknown identifiers",
    async (repository) => {
      assertEquals(await repository.find_by_id("missing"), null);
      assertEquals(await repository.find_by_secret_hash("missing"), null);
      assertEquals(await repository.list_by_owner("missing"), []);
      assertEquals(await repository.revoke_all_by_owner("missing"), 0);
      const revoked = await repository.revoke("missing", "user-1", 1);
      assert(!revoked.ok && revoked.reason === "not_found");
    },
  );

  conformance_test(
    "creates and resolves records by ID and secret hash",
    async (repository) => {
      const stored = record({
        permissions: ["read", "write"],
        expires_at: new Date("2026-08-01T00:00:00.000Z"),
      });
      assert(await repository.create(stored));
      assertEquals(await repository.find_by_id("key-1"), stored);
      assertEquals(await repository.find_by_secret_hash("hash-1"), stored);
    },
  );

  conformance_test(
    "create refuses ID and secret-hash collisions",
    async (repository) => {
      assert(await repository.create(record()));
      assert(!await repository.create(record({ secret_hash: "hash-2" })));
      assert(!await repository.create(record({ api_key_id: "key-2" })));
      assert(
        await repository.create(
          record({ api_key_id: "key-2", secret_hash: "hash-2" }),
        ),
      );
    },
  );

  conformance_test(
    "concurrent creates with one secret hash keep a single record",
    async (repository) => {
      const outcomes = await Promise.all([
        repository.create(record({ api_key_id: "key-a" })),
        repository.create(record({ api_key_id: "key-b" })),
      ]);
      assertEquals(outcomes.filter((created) => created).length, 1);
      const resolved = await repository.find_by_secret_hash("hash-1");
      assert(resolved !== null);
      assertEquals(
        resolved.api_key_id,
        outcomes[0] ? "key-a" : "key-b",
      );
    },
  );

  conformance_test("returns copies, not shared state", async (repository) => {
    const input = record();
    assert(await repository.create(input));
    input.created_at.setUTCFullYear(1999);
    input.updated_at.setUTCFullYear(1999);

    const first = await repository.find_by_id("key-1");
    assert(first !== null);
    assertEquals(first.created_at, created_at);
    first.created_at.setUTCFullYear(2001);
    (first.permissions as ApiKeyPermission[]).push("delete");

    const second = await repository.find_by_secret_hash("hash-1");
    assert(second !== null);
    assertEquals(second.created_at, created_at);
    assertEquals(second.permissions, ["read"]);
  });

  conformance_test("lists only the owner's keys", async (repository) => {
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
    const owned = await repository.list_by_owner("user-1");
    assertEquals(
      owned.map((stored) => stored.api_key_id).sort(),
      ["key-1", "key-2"],
    );
    assertEquals(
      (await repository.list_by_owner("user-2")).map((stored) =>
        stored.api_key_id
      ),
      ["key-3"],
    );
  });

  conformance_test(
    "update enforces owner and revision, then increments",
    async (repository) => {
      await repository.create(record());
      const base = {
        api_key_id: "key-1",
        expected_revision: 1,
        label: "renamed",
        permissions: ["read", "delete"],
        expires_at: new Date("2026-09-01T00:00:00.000Z"),
        updated_at: new Date("2026-07-23T00:00:00.000Z"),
      } as const;

      const foreign = await repository.update({
        ...base,
        owner_user_id: "user-2",
      });
      assert(!foreign.ok && foreign.reason === "not_found");

      const stale = await repository.update({
        ...base,
        owner_user_id: "user-1",
        expected_revision: 2,
      });
      assert(!stale.ok && stale.reason === "stale_revision");

      const updated = await repository.update({
        ...base,
        owner_user_id: "user-1",
      });
      assert(updated.ok);
      assertEquals(updated.record.revision, 2);
      assertEquals(updated.record.label, "renamed");
      assertEquals(updated.record.permissions, ["read", "delete"]);
      assertEquals(
        updated.record.expires_at,
        new Date("2026-09-01T00:00:00.000Z"),
      );

      const stored = await repository.find_by_id("key-1");
      assert(stored !== null);
      assertEquals(stored, updated.record);
    },
  );

  conformance_test(
    "concurrent updates against one revision allow exactly one winner",
    async (repository) => {
      await repository.create(record());
      const attempt = (label: string) =>
        repository.update({
          api_key_id: "key-1",
          owner_user_id: "user-1",
          expected_revision: 1,
          label,
          permissions: ["read"],
          expires_at: null,
          updated_at: new Date("2026-07-23T00:00:00.000Z"),
        });

      const outcomes = await Promise.all([attempt("first"), attempt("second")]);
      assertEquals(outcomes.filter((outcome) => outcome.ok).length, 1);
      const loser = outcomes.find((outcome) => !outcome.ok);
      assert(loser !== undefined && !loser.ok);
      assertEquals(loser.reason, "stale_revision");
      const stored = await repository.find_by_id("key-1");
      assert(stored !== null);
      assertEquals(stored.revision, 2);
    },
  );

  conformance_test(
    "revoke is owner-scoped, revision-bound, and frees identifiers",
    async (repository) => {
      await repository.create(record());

      const foreign = await repository.revoke("key-1", "user-2", 1);
      assert(!foreign.ok && foreign.reason === "not_found");

      const stale = await repository.revoke("key-1", "user-1", 2);
      assert(!stale.ok && stale.reason === "stale_revision");

      const revoked = await repository.revoke("key-1", "user-1", 1);
      assert(revoked.ok);
      assertEquals(await repository.find_by_id("key-1"), null);
      assertEquals(await repository.find_by_secret_hash("hash-1"), null);
      assertEquals(await repository.list_by_owner("user-1"), []);

      assert(
        await repository.create(record()),
        "revoked identifiers are free again",
      );
    },
  );

  conformance_test(
    "revoke_all_by_owner revokes every owner key and nothing else",
    async (repository) => {
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
      assertEquals(await repository.find_by_id("key-1"), null);
      assertEquals(await repository.find_by_id("key-2"), null);
      assertEquals(await repository.find_by_secret_hash("hash-1"), null);
      assertEquals(await repository.find_by_secret_hash("hash-2"), null);

      const foreign = await repository.list_by_owner("user-2");
      assertEquals(foreign.map((stored) => stored.api_key_id), ["key-3"]);
      assert(await repository.find_by_secret_hash("hash-3") !== null);
    },
  );

  conformance_test(
    "identifiers and hashes are free again after revoke_all",
    async (repository) => {
      await repository.create(record());
      assertEquals(await repository.revoke_all_by_owner("user-1"), 1);

      assert(await repository.create(record({ label: "reborn" })));
      const resolved = await repository.find_by_secret_hash("hash-1");
      assert(resolved !== null);
      assertEquals(resolved.label, "reborn");
      assertEquals(
        (await repository.list_by_owner("user-1")).map((stored) =>
          stored.label
        ),
        ["reborn"],
      );
    },
  );

  conformance_test(
    "repeated revoke_all cycles stay consistent",
    async (repository) => {
      await repository.create(record());
      assertEquals(await repository.revoke_all_by_owner("user-1"), 1);
      assertEquals(await repository.revoke_all_by_owner("user-1"), 0);

      await repository.create(
        record({ api_key_id: "key-2", secret_hash: "hash-2" }),
      );
      assertEquals(await repository.revoke_all_by_owner("user-1"), 1);
      assertEquals(await repository.list_by_owner("user-1"), []);
      assertEquals(await repository.find_by_secret_hash("hash-2"), null);
    },
  );

  conformance_test(
    "updated and revoked state persists across sequential operations",
    async (repository) => {
      await repository.create(record());
      const updated = await repository.update({
        api_key_id: "key-1",
        owner_user_id: "user-1",
        expected_revision: 1,
        label: "step-two",
        permissions: ["write"],
        expires_at: null,
        updated_at: new Date("2026-07-23T00:00:00.000Z"),
      });
      assert(updated.ok);

      const stale_revoke = await repository.revoke("key-1", "user-1", 1);
      assert(!stale_revoke.ok && stale_revoke.reason === "stale_revision");
      const revoked = await repository.revoke("key-1", "user-1", 2);
      assert(revoked.ok);
      assertEquals(await repository.find_by_id("key-1"), null);
    },
  );
}
