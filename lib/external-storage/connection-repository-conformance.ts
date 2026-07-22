import { assert, assertEquals, assertRejects } from "@std/assert";
import type {
  StorageConnection,
  StorageConnectionCredentials,
} from "./connection-model.ts";
import type { StorageConnectionRepository } from "./connection-repository.ts";

export interface StorageConnectionRepositoryConformanceOptions {
  readonly name: string;
  /** Must return a fresh, empty repository for every test. */
  readonly make_repository: () =>
    | StorageConnectionRepository
    | Promise<StorageConnectionRepository>;
  readonly teardown?: (
    repository: StorageConnectionRepository,
  ) => void | Promise<void>;
}

const created_at = new Date("2026-07-22T10:00:00.000Z");
const revoked_at = new Date("2026-07-22T11:00:00.000Z");

function connection(
  overrides: Partial<StorageConnection> = {},
): StorageConnection {
  return {
    connection_id: "connection-1",
    user_id: "user-1",
    provider_id: "google-drive",
    provider_subject: "provider-user-1",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    status: "active",
    created_at: new Date(created_at),
    updated_at: new Date(created_at),
    ...overrides,
  };
}

function credentials(
  overrides: Partial<StorageConnectionCredentials> = {},
): StorageConnectionCredentials {
  return {
    access_token: "access-secret",
    refresh_token: "refresh-secret",
    access_token_expires_at: new Date("2026-07-22T12:00:00.000Z"),
    ...overrides,
  };
}

/** Registers the complete storage-connection persistence contract. */
export function test_storage_connection_repository_conformance(
  options: StorageConnectionRepositoryConformanceOptions,
): void {
  const conformance_test = (
    label: string,
    run: (repository: StorageConnectionRepository) => Promise<void>,
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

  conformance_test("returns empty results for unknown connections", async (
    repository,
  ) => {
    assertEquals(await repository.find_by_id("missing"), null);
    assertEquals(
      await repository.find_active_by_user_provider("user-1", "google-drive"),
      null,
    );
    assertEquals(await repository.list_by_user("user-1"), []);
    assertEquals(await repository.get_credentials("missing"), null);
    assertEquals(
      await repository.put_credentials("missing", credentials()),
      false,
    );
    assertEquals(
      await repository.revoke("missing", "user-1", revoked_at),
      null,
    );
  });

  conformance_test("creates and resolves owner-safe metadata", async (
    repository,
  ) => {
    const input = connection();
    const created = await repository.create(input);
    assert(created.ok);
    assertEquals(created.connection, input);
    assertEquals(await repository.find_by_id(input.connection_id), input);
    assertEquals(
      await repository.find_active_by_user_provider(
        input.user_id,
        input.provider_id,
      ),
      input,
    );
    assertEquals(await repository.list_by_user(input.user_id), [input]);
    assertEquals(await repository.get_credentials(input.connection_id), null);

    const serialized = JSON.stringify(await repository.list_by_user("user-1"));
    assertEquals(serialized.includes("access-secret"), false);
    assertEquals(serialized.includes("refresh-secret"), false);
    assertEquals(serialized.includes("token"), false);
  });

  conformance_test("returns copies instead of shared metadata state", async (
    repository,
  ) => {
    const input = connection();
    const pending = repository.create(input);
    input.created_at.setUTCFullYear(1999);
    input.updated_at.setUTCFullYear(1999);
    (input.scopes as string[]).push("mutated");
    assert((await pending).ok);

    const first = await repository.find_by_id("connection-1");
    assert(first !== null);
    assertEquals(first.created_at, created_at);
    assertEquals(first.scopes, [
      "https://www.googleapis.com/auth/drive.file",
    ]);
    first.created_at.setUTCFullYear(2000);
    (first.scopes as string[]).push("changed");
    assertEquals(await repository.find_by_id("connection-1"), connection());
  });

  conformance_test(
    "enforces one active connection per user and provider atomically",
    async (repository) => {
      const outcomes = await Promise.all([
        repository.create(connection({ connection_id: "connection-a" })),
        repository.create(connection({ connection_id: "connection-b" })),
      ]);
      assertEquals(outcomes.filter((outcome) => outcome.ok).length, 1);
      const loser = outcomes.find((outcome) => !outcome.ok);
      assert(loser !== undefined && !loser.ok);
      assertEquals(loser.reason, "active_connection_conflict");
      assertEquals((await repository.list_by_user("user-1")).length, 1);
    },
  );

  conformance_test("refuses connection ID collisions independently", async (
    repository,
  ) => {
    assert((await repository.create(connection())).ok);
    const collision = await repository.create(connection({
      user_id: "user-2",
      provider_id: "other-storage",
      provider_subject: "other-subject",
    }));
    assert(!collision.ok);
    assertEquals(collision.reason, "connection_id_conflict");
  });

  conformance_test("lists only one user's connections in stable order", async (
    repository,
  ) => {
    assert(
      (await repository.create(connection({
        connection_id: "connection-b",
        provider_id: "other-storage",
        provider_subject: "subject-b",
        created_at: new Date("2026-07-22T10:01:00.000Z"),
        updated_at: new Date("2026-07-22T10:01:00.000Z"),
      }))).ok,
    );
    assert(
      (await repository.create(connection({
        connection_id: "connection-a",
      }))).ok,
    );
    assert(
      (await repository.create(connection({
        connection_id: "connection-foreign",
        user_id: "user-2",
        provider_subject: "foreign-subject",
      }))).ok,
    );

    assertEquals(
      (await repository.list_by_user("user-1")).map((item) =>
        item.connection_id
      ),
      ["connection-a", "connection-b"],
    );
    assertEquals(
      (await repository.list_by_user("user-2")).map((item) =>
        item.connection_id
      ),
      ["connection-foreign"],
    );
  });

  conformance_test("round-trips isolated server-only credentials", async (
    repository,
  ) => {
    assert((await repository.create(connection())).ok);
    const input = credentials();
    assert(await repository.put_credentials("connection-1", input));
    input.access_token_expires_at!.setUTCFullYear(1999);

    const first = await repository.get_credentials("connection-1");
    assertEquals(first, credentials());
    first!.access_token_expires_at!.setUTCFullYear(2000);
    assertEquals(
      await repository.get_credentials("connection-1"),
      credentials(),
    );

    assert(
      await repository.put_credentials(
        "connection-1",
        credentials({
          access_token: "replacement-access",
          refresh_token: undefined,
          access_token_expires_at: undefined,
        }),
      ),
    );
    assertEquals(await repository.get_credentials("connection-1"), {
      access_token: "replacement-access",
    });
  });

  conformance_test(
    "reauthorizes the same provider subject and restores revoked credentials",
    async (repository) => {
      assert((await repository.create(connection())).ok);
      assert(await repository.put_credentials("connection-1", credentials()));
      assert(await repository.revoke("connection-1", "user-1", revoked_at));

      const mismatch = await repository.reauthorize({
        connection_id: "connection-1",
        user_id: "user-1",
        provider_subject: "different-provider-user",
        scopes: ["drive.file"],
        credentials: credentials({ access_token: "wrong-access" }),
        updated_at: new Date("2026-07-22T12:00:00.000Z"),
      });
      assert(!mismatch.ok);
      assertEquals(mismatch.reason, "provider_subject_mismatch");
      assertEquals(await repository.get_credentials("connection-1"), null);

      const reauthorized = await repository.reauthorize({
        connection_id: "connection-1",
        user_id: "user-1",
        provider_subject: "provider-user-1",
        scopes: ["drive.file", "drive.metadata.readonly"],
        credentials: credentials({
          access_token: "renewed-access",
          refresh_token: "renewed-refresh",
        }),
        updated_at: new Date("2026-07-22T12:00:00.000Z"),
      });
      assert(reauthorized.ok);
      assertEquals(reauthorized.connection.status, "active");
      assertEquals(reauthorized.connection.scopes, [
        "drive.file",
        "drive.metadata.readonly",
      ]);
      assertEquals(
        await repository.find_active_by_user_provider(
          "user-1",
          "google-drive",
        ),
        reauthorized.connection,
      );
      assertEquals(
        await repository.get_credentials("connection-1"),
        credentials({
          access_token: "renewed-access",
          refresh_token: "renewed-refresh",
        }),
      );
    },
  );

  conformance_test(
    "does not reactivate a retained record over another live connection",
    async (repository) => {
      assert((await repository.create(connection())).ok);
      assert(await repository.revoke("connection-1", "user-1", revoked_at));
      assert(
        (await repository.create(connection({
          connection_id: "connection-2",
          provider_subject: "provider-user-2",
          created_at: new Date("2026-07-22T12:00:00.000Z"),
          updated_at: new Date("2026-07-22T12:00:00.000Z"),
        }))).ok,
      );

      const result = await repository.reauthorize({
        connection_id: "connection-1",
        user_id: "user-1",
        provider_subject: "provider-user-1",
        scopes: ["drive.file"],
        credentials: credentials(),
        updated_at: new Date("2026-07-22T13:00:00.000Z"),
      });
      assert(!result.ok);
      assertEquals(result.reason, "active_connection_conflict");
      assertEquals(await repository.get_credentials("connection-1"), null);
    },
  );

  conformance_test(
    "revocation retains metadata, frees the active slot, and destroys credentials",
    async (repository) => {
      assert((await repository.create(connection())).ok);
      assert(await repository.put_credentials("connection-1", credentials()));
      assertEquals(
        await repository.revoke("connection-1", "user-2", revoked_at),
        null,
      );
      assertEquals(
        await repository.get_credentials("connection-1"),
        credentials(),
      );

      const revoked = await repository.revoke(
        "connection-1",
        "user-1",
        revoked_at,
      );
      assert(revoked !== null);
      assertEquals(revoked.status, "revoked");
      assertEquals(revoked.updated_at, revoked_at);
      assertEquals(await repository.find_by_id("connection-1"), revoked);
      assertEquals(
        await repository.find_active_by_user_provider("user-1", "google-drive"),
        null,
      );
      assertEquals(await repository.get_credentials("connection-1"), null);
      assertEquals(
        await repository.put_credentials("connection-1", credentials()),
        false,
      );

      const replacement = connection({
        connection_id: "connection-2",
        provider_subject: "provider-user-2",
        created_at: new Date(revoked_at),
        updated_at: new Date(revoked_at),
      });
      assert((await repository.create(replacement)).ok);
      assertEquals(
        await repository.find_active_by_user_provider("user-1", "google-drive"),
        replacement,
      );
      assertEquals((await repository.list_by_user("user-1")).length, 2);
    },
  );

  conformance_test(
    "revocation is idempotent and does not rewrite its time",
    async (
      repository,
    ) => {
      assert((await repository.create(connection())).ok);
      const first = await repository.revoke(
        "connection-1",
        "user-1",
        revoked_at,
      );
      const second = await repository.revoke(
        "connection-1",
        "user-1",
        new Date("2026-07-22T13:00:00.000Z"),
      );
      assertEquals(second, first);
    },
  );

  conformance_test("rejects malformed metadata and credentials", async (
    repository,
  ) => {
    await assertRejects(
      async () =>
        await repository.create(connection({ connection_id: "bad/id" })),
      TypeError,
    );
    await assertRejects(
      async () => await repository.create(connection({ status: "revoked" })),
      TypeError,
    );
    assert((await repository.create(connection())).ok);
    await assertRejects(
      async () =>
        await repository.put_credentials(
          "connection-1",
          credentials({ access_token: "" }),
        ),
      TypeError,
    );
    await assertRejects(
      async () =>
        await repository.revoke(
          "connection-1",
          "user-1",
          new Date("2026-07-22T09:00:00.000Z"),
        ),
      TypeError,
    );
  });
}
