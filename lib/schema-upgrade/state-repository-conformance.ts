import { assertEquals } from "@std/assert";
import type { SchemaUpgradeStateRepository } from "./interfaces.ts";

export interface SchemaUpgradeStateRepositoryConformanceOptions {
  readonly name: string;
  readonly make_repository: () =>
    | SchemaUpgradeStateRepository
    | Promise<SchemaUpgradeStateRepository>;
  readonly teardown?: (
    repository: SchemaUpgradeStateRepository,
  ) => void | Promise<void>;
}

/** Shared atomic-state contract for every schema-upgrade coordination adapter. */
export function test_schema_upgrade_state_repository_conformance(
  options: SchemaUpgradeStateRepositoryConformanceOptions,
): void {
  const conformance_test = (
    label: string,
    run: (repository: SchemaUpgradeStateRepository) => Promise<void>,
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

  conformance_test("initializes an absent baseline exactly once", async (
    repository,
  ) => {
    assertEquals(await repository.read_state("pages"), null);
    assertEquals(
      await repository.initialize_state({
        schema_id: "pages",
        baseline_version: 1,
      }),
      "applied",
    );
    assertEquals(
      await repository.initialize_state({
        schema_id: "pages",
        baseline_version: 2,
      }),
      "conflict",
    );
    assertEquals(await repository.read_state("pages"), {
      current_version: 1,
      pending_transition: null,
    });
  });

  conformance_test("claims only an exact completed version", async (
    repository,
  ) => {
    await repository.initialize_state({
      schema_id: "pages",
      baseline_version: 1,
    });
    const transition = {
      step_id: "pages-v1-to-v2",
      from_version: 1,
      to_version: 2,
    } as const;
    assertEquals(
      await repository.claim_transition({
        schema_id: "pages",
        expected_current_version: 2,
        transition: { ...transition, from_version: 2, to_version: 3 },
      }),
      "conflict",
    );
    assertEquals(
      await repository.claim_transition({
        schema_id: "pages",
        expected_current_version: 1,
        transition,
      }),
      "applied",
    );
    assertEquals(
      await repository.claim_transition({
        schema_id: "pages",
        expected_current_version: 1,
        transition,
      }),
      "conflict",
    );
    assertEquals(await repository.read_state("pages"), {
      current_version: 1,
      pending_transition: transition,
    });
  });

  conformance_test("completes only the matching pending transition", async (
    repository,
  ) => {
    const transition = {
      step_id: "pages-v1-to-v2",
      from_version: 1,
      to_version: 2,
    } as const;
    await repository.initialize_state({
      schema_id: "pages",
      baseline_version: 1,
    });
    await repository.claim_transition({
      schema_id: "pages",
      expected_current_version: 1,
      transition,
    });
    assertEquals(
      await repository.complete_transition({
        schema_id: "pages",
        transition: { ...transition, step_id: "other-step" },
      }),
      "conflict",
    );
    assertEquals(
      await repository.complete_transition({ schema_id: "pages", transition }),
      "applied",
    );
    assertEquals(
      await repository.complete_transition({ schema_id: "pages", transition }),
      "conflict",
    );
    assertEquals(await repository.read_state("pages"), {
      current_version: 2,
      pending_transition: null,
    });
  });

  conformance_test("allows one winner for concurrent transition claims", async (
    repository,
  ) => {
    await repository.initialize_state({
      schema_id: "pages",
      baseline_version: 1,
    });
    const transition = {
      step_id: "pages-v1-to-v2",
      from_version: 1,
      to_version: 2,
    } as const;
    const results = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          repository.claim_transition({
            schema_id: "pages",
            expected_current_version: 1,
            transition,
          }),
      ),
    );
    assertEquals(results.filter((result) => result === "applied").length, 1);
    assertEquals(results.filter((result) => result === "conflict").length, 7);
  });

  conformance_test("keeps independent schema IDs isolated", async (
    repository,
  ) => {
    await repository.initialize_state({
      schema_id: "ownership",
      baseline_version: 1,
    });
    await repository.initialize_state({
      schema_id: "sessions",
      baseline_version: 3,
    });
    assertEquals(await repository.read_state("ownership"), {
      current_version: 1,
      pending_transition: null,
    });
    assertEquals(await repository.read_state("sessions"), {
      current_version: 3,
      pending_transition: null,
    });
  });
}
