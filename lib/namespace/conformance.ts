import { assert, assertEquals } from "@std/assert";
import type { NamespaceRepository } from "./interfaces.ts";

export interface NamespaceConformanceOptions {
  /** Implementation name used as the test-name prefix. */
  name: string;
  /** Must return a fresh, empty repository for every test. */
  make_repository: () => NamespaceRepository | Promise<NamespaceRepository>;
  /** Optional per-test cleanup (close connections, drop state). */
  teardown?: (repository: NamespaceRepository) => void | Promise<void>;
}

/**
 * Implementation-agnostic conformance suite for `NamespaceRepository`
 * (DA-NAMESPACE): registers the contract's atomicity and case rules as Deno
 * tests against any backend. Durable implementations reuse it unchanged by
 * calling it with their own factory.
 */
export function test_namespace_repository_conformance(
  options: NamespaceConformanceOptions,
): void {
  const conformance_test = (
    label: string,
    run: (repository: NamespaceRepository) => Promise<void>,
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

  conformance_test("find of an unreserved namespace returns null", async (
    repository,
  ) => {
    assertEquals(await repository.find("free"), null);
  });

  conformance_test("reserve claims a free namespace for its owner", async (
    repository,
  ) => {
    const result = await repository.reserve({
      namespace: "MyNs",
      owner_user_id: "user-a",
    });
    assert(result.ok);
    assertEquals(result.reservation.namespace, "MyNs");
    assertEquals(result.reservation.owner_user_id, "user-a");
    assert(result.reservation.reserved_at instanceof Date);
  });

  conformance_test(
    "duplicate reserve is rejected as taken across casings",
    async (repository) => {
      const first = await repository.reserve({
        namespace: "MyNs",
        owner_user_id: "user-a",
      });
      assert(first.ok);
      for (const namespace of ["MyNs", "myns", "MYNS", "mYnS"]) {
        const attempt = await repository.reserve({
          namespace,
          owner_user_id: "user-b",
        });
        assertEquals(attempt, { ok: false, reason: "taken" });
      }
    },
  );

  conformance_test(
    "a losing attempt never replaces the stored reservation",
    async (repository) => {
      await repository.reserve({ namespace: "MyNs", owner_user_id: "user-a" });
      await repository.reserve({ namespace: "MYNS", owner_user_id: "user-b" });
      const found = await repository.find("myns");
      assertEquals(found?.namespace, "MyNs");
      assertEquals(found?.owner_user_id, "user-a");
    },
  );

  conformance_test(
    "lookup is case-insensitive and preserves supplied casing",
    async (repository) => {
      await repository.reserve({ namespace: "MyNs", owner_user_id: "user-a" });
      for (const lookup of ["MyNs", "myns", "MYNS"]) {
        const found = await repository.find(lookup);
        assertEquals(found?.namespace, "MyNs");
      }
    },
  );

  conformance_test(
    "list_by_owner returns exactly the owner's reservations",
    async (repository) => {
      await repository.reserve({ namespace: "One", owner_user_id: "user-a" });
      await repository.reserve({ namespace: "Two", owner_user_id: "user-b" });
      await repository.reserve({ namespace: "Three", owner_user_id: "user-a" });
      const owned = await repository.list_by_owner("user-a");
      assertEquals(
        owned.map((reservation) => reservation.namespace).sort(),
        ["One", "Three"],
      );
      assertEquals(await repository.list_by_owner("user-c"), []);
    },
  );

  conformance_test(
    "concurrent reserve of one namespace yields exactly one winner",
    async (repository) => {
      const casings = ["Race", "race", "RACE", "rAcE", "RaCe", "raCE"];
      const results = await Promise.all(
        casings.map((namespace, index) =>
          repository.reserve({
            namespace,
            owner_user_id: `user-${index}`,
          })
        ),
      );
      const winners = results.filter((result) => result.ok);
      assertEquals(winners.length, 1);
      assertEquals(
        results.filter((result) => !result.ok && result.reason === "taken")
          .length,
        casings.length - 1,
      );
      const winner_index = results.findIndex((result) => result.ok);
      const found = await repository.find("race");
      assertEquals(found?.namespace, casings[winner_index]);
      assertEquals(found?.owner_user_id, `user-${winner_index}`);
    },
  );

  conformance_test(
    "distinct namespaces are reserved independently",
    async (repository) => {
      const first = await repository.reserve({
        namespace: "alpha",
        owner_user_id: "user-a",
      });
      const second = await repository.reserve({
        namespace: "beta",
        owner_user_id: "user-a",
      });
      assert(first.ok);
      assert(second.ok);
      assertEquals((await repository.find("alpha"))?.namespace, "alpha");
      assertEquals((await repository.find("beta"))?.namespace, "beta");
    },
  );
}
