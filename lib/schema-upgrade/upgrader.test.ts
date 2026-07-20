import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { SchemaUpgradeError } from "./errors.ts";
import type {
  SchemaUpgradePlan,
  SchemaUpgradeState,
  SchemaUpgradeStateMutationResult,
  SchemaUpgradeStateRepository,
  SchemaUpgradeTransition,
} from "./interfaces.ts";
import { ForwardDatabaseSchemaUpgrader } from "./upgrader.ts";

function clone_state(state: SchemaUpgradeState): SchemaUpgradeState {
  return {
    current_version: state.current_version,
    pending_transition: state.pending_transition === null
      ? null
      : { ...state.pending_transition },
  };
}

class MemorySchemaUpgradeStateRepository
  implements SchemaUpgradeStateRepository {
  readonly states = new Map<string, SchemaUpgradeState>();
  write_count = 0;
  fail_next_completion = false;

  seed(schema_id: string, state: SchemaUpgradeState): void {
    this.states.set(schema_id, clone_state(state));
  }

  read_state(schema_id: string): Promise<SchemaUpgradeState | null> {
    const state = this.states.get(schema_id);
    return Promise.resolve(state === undefined ? null : clone_state(state));
  }

  initialize_state(input: {
    readonly schema_id: string;
    readonly baseline_version: number;
  }): Promise<SchemaUpgradeStateMutationResult> {
    if (this.states.has(input.schema_id)) return Promise.resolve("conflict");
    this.states.set(input.schema_id, {
      current_version: input.baseline_version,
      pending_transition: null,
    });
    this.write_count += 1;
    return Promise.resolve("applied");
  }

  claim_transition(input: {
    readonly schema_id: string;
    readonly expected_current_version: number;
    readonly transition: SchemaUpgradeTransition;
  }): Promise<SchemaUpgradeStateMutationResult> {
    const state = this.states.get(input.schema_id);
    if (
      state === undefined ||
      state.current_version !== input.expected_current_version ||
      state.pending_transition !== null
    ) {
      return Promise.resolve("conflict");
    }
    this.states.set(input.schema_id, {
      current_version: state.current_version,
      pending_transition: { ...input.transition },
    });
    this.write_count += 1;
    return Promise.resolve("applied");
  }

  complete_transition(input: {
    readonly schema_id: string;
    readonly transition: SchemaUpgradeTransition;
  }): Promise<SchemaUpgradeStateMutationResult> {
    if (this.fail_next_completion) {
      this.fail_next_completion = false;
      return Promise.reject(new Error("injected completion failure"));
    }
    const state = this.states.get(input.schema_id);
    const pending = state?.pending_transition;
    if (
      state === undefined || pending === null || pending === undefined ||
      pending.step_id !== input.transition.step_id ||
      pending.from_version !== input.transition.from_version ||
      pending.to_version !== input.transition.to_version
    ) {
      return Promise.resolve("conflict");
    }
    this.states.set(input.schema_id, {
      current_version: input.transition.to_version,
      pending_transition: null,
    });
    this.write_count += 1;
    return Promise.resolve("applied");
  }
}

function plan<Context>(
  target_version: number,
  upgrades: readonly ((context: Context) => void | Promise<void>)[],
  options: { schema_id?: string; baseline_version?: number } = {},
): SchemaUpgradePlan<Context> {
  const baseline_version = options.baseline_version ?? 1;
  const schema_id = options.schema_id ?? "pages";
  return {
    schema_id,
    baseline_version,
    target_version,
    steps: upgrades.map((upgrade, index) => ({
      step_id: `${schema_id}-v${baseline_version + index}-to-v${
        baseline_version + index + 1
      }`,
      from_version: baseline_version + index,
      to_version: baseline_version + index + 1,
      upgrade,
    })),
  };
}

Deno.test("schema upgrader accepts an empty registry without state writes", async () => {
  const repository = new MemorySchemaUpgradeStateRepository();
  const upgrader = new ForwardDatabaseSchemaUpgrader<undefined>({
    state_repository: repository,
    plans: [],
  });

  assertEquals(await upgrader.upgrade(undefined), { schemas: [] });
  assertEquals(repository.write_count, 0);
});

Deno.test("schema upgrader installs a current baseline and repeats as no change", async () => {
  const repository = new MemorySchemaUpgradeStateRepository();
  const upgrader = new ForwardDatabaseSchemaUpgrader<undefined>({
    state_repository: repository,
    plans: [plan(1, [])],
  });

  assertEquals(await upgrader.upgrade(undefined), {
    schemas: [{
      schema_id: "pages",
      initial_version: 1,
      target_version: 1,
      outcome: "no_change",
      transitions: [],
    }],
  });
  assertEquals(repository.write_count, 1);
  assertEquals(
    (await upgrader.upgrade(undefined)).schemas[0].outcome,
    "no_change",
  );
  assertEquals(repository.write_count, 1);
});

Deno.test("schema upgrader applies every skipped application version in exact order", async () => {
  const repository = new MemorySchemaUpgradeStateRepository();
  const applied: string[] = [];
  const upgrader = new ForwardDatabaseSchemaUpgrader<undefined>({
    state_repository: repository,
    plans: [plan(4, [
      () => {
        applied.push("one-to-two");
      },
      () => {
        applied.push("two-to-three");
      },
      () => {
        applied.push("three-to-four");
      },
    ])],
  });

  const report = await upgrader.upgrade(undefined);
  assertEquals(applied, ["one-to-two", "two-to-three", "three-to-four"]);
  assertEquals(report.schemas[0], {
    schema_id: "pages",
    initial_version: 1,
    target_version: 4,
    outcome: "upgraded",
    transitions: [
      {
        step_id: "pages-v1-to-v2",
        from_version: 1,
        to_version: 2,
        execution: "upgraded",
      },
      {
        step_id: "pages-v2-to-v3",
        from_version: 2,
        to_version: 3,
        execution: "upgraded",
      },
      {
        step_id: "pages-v3-to-v4",
        from_version: 3,
        to_version: 4,
        execution: "upgraded",
      },
    ],
  });
  assertEquals(await repository.read_state("pages"), {
    current_version: 4,
    pending_transition: null,
  });

  await upgrader.upgrade(undefined);
  assertEquals(applied, ["one-to-two", "two-to-three", "three-to-four"]);
});

Deno.test("schema upgrader resumes the exact retained pending helper", async () => {
  const repository = new MemorySchemaUpgradeStateRepository();
  repository.seed("pages", {
    current_version: 1,
    pending_transition: {
      step_id: "pages-v1-to-v2",
      from_version: 1,
      to_version: 2,
    },
  });
  let calls = 0;
  const upgrader = new ForwardDatabaseSchemaUpgrader<undefined>({
    state_repository: repository,
    plans: [plan(2, [() => {
      calls += 1;
    }])],
  });

  const report = await upgrader.upgrade(undefined);
  assertEquals(calls, 1);
  assertEquals(report.schemas[0].outcome, "resumed");
  assertEquals(report.schemas[0].transitions[0].execution, "resumed");
  assertEquals(await repository.read_state("pages"), {
    current_version: 2,
    pending_transition: null,
  });
});

Deno.test("schema upgrader resumes an idempotent helper after a midway failure", async () => {
  const repository = new MemorySchemaUpgradeStateRepository();
  const data = new Set<string>();
  let fail_midway = true;
  const upgrader = new ForwardDatabaseSchemaUpgrader<undefined>({
    state_repository: repository,
    plans: [plan(2, [() => {
      data.add("first-record");
      if (fail_midway) {
        fail_midway = false;
        throw new Error("interrupted");
      }
      data.add("second-record");
    }])],
  });

  const failure = await assertRejects(() => upgrader.upgrade(undefined));
  assertInstanceOf(failure, SchemaUpgradeError);
  assertEquals(failure.code, "step_failed");
  assertEquals(data, new Set(["first-record"]));
  assertEquals((await repository.read_state("pages"))?.pending_transition, {
    step_id: "pages-v1-to-v2",
    from_version: 1,
    to_version: 2,
  });

  const report = await upgrader.upgrade(undefined);
  assertEquals(report.schemas[0].outcome, "resumed");
  assertEquals(data, new Set(["first-record", "second-record"]));
  assertEquals((await repository.read_state("pages"))?.current_version, 2);
});

Deno.test("schema upgrader resumes after data changes but before completion", async () => {
  const repository = new MemorySchemaUpgradeStateRepository();
  repository.fail_next_completion = true;
  let data_mutations = 0;
  const upgrader = new ForwardDatabaseSchemaUpgrader<undefined>({
    state_repository: repository,
    plans: [plan(2, [() => {
      if (data_mutations === 0) data_mutations += 1;
    }])],
  });

  const failure = await assertRejects(() => upgrader.upgrade(undefined));
  assertInstanceOf(failure, SchemaUpgradeError);
  assertEquals(failure.code, "state_repository_failed");
  assertEquals(data_mutations, 1);
  assertEquals((await repository.read_state("pages"))?.pending_transition, {
    step_id: "pages-v1-to-v2",
    from_version: 1,
    to_version: 2,
  });

  assertEquals(
    (await upgrader.upgrade(undefined)).schemas[0].outcome,
    "resumed",
  );
  assertEquals(data_mutations, 1);
  assertEquals((await repository.read_state("pages"))?.current_version, 2);
});

Deno.test("schema upgrader validates every plan before any state write", () => {
  const invalid_plans: unknown[] = [
    [{ schema_id: "Bad", baseline_version: 1, target_version: 1, steps: [] }],
    [
      plan(1, [], { schema_id: "pages" }),
      plan(1, [], { schema_id: "pages" }),
    ],
    [{
      schema_id: "pages",
      baseline_version: 1,
      target_version: 2,
      steps: [{
        step_id: "pages-v1-to-v3",
        from_version: 1,
        to_version: 3,
        upgrade: () => undefined,
      }],
    }],
    [{
      schema_id: "pages",
      baseline_version: 1,
      target_version: 3,
      steps: [{
        step_id: "same-step",
        from_version: 1,
        to_version: 2,
        upgrade: () => undefined,
      }, {
        step_id: "same-step",
        from_version: 2,
        to_version: 3,
        upgrade: () => undefined,
      }],
    }],
    [{ schema_id: "pages", baseline_version: 2, target_version: 1, steps: [] }],
  ];

  for (const invalid of invalid_plans) {
    const repository = new MemorySchemaUpgradeStateRepository();
    const error = assertThrows(
      () =>
        new ForwardDatabaseSchemaUpgrader({
          state_repository: repository,
          plans: invalid as readonly SchemaUpgradePlan<unknown>[],
        }),
    );
    assertInstanceOf(error, SchemaUpgradeError);
    assertEquals(error.code, "invalid_plan");
    assertEquals(repository.write_count, 0);
  }
});

Deno.test("schema upgrader preflights all durable versions before any write", async () => {
  const repository = new MemorySchemaUpgradeStateRepository();
  repository.seed("sessions", {
    current_version: 3,
    pending_transition: null,
  });
  const upgrader = new ForwardDatabaseSchemaUpgrader<undefined>({
    state_repository: repository,
    plans: [
      plan(1, [], { schema_id: "ownership" }),
      plan(2, [() => undefined], { schema_id: "sessions" }),
    ],
  });

  const error = await assertRejects(() => upgrader.upgrade(undefined));
  assertInstanceOf(error, SchemaUpgradeError);
  assertEquals(error.code, "future_version");
  assertEquals(repository.write_count, 0);
  assertEquals(await repository.read_state("ownership"), null);
});

Deno.test("schema upgrader fails closed on unsupported, pending, and corrupt state", async () => {
  const cases: readonly {
    state: SchemaUpgradeState;
    plan: SchemaUpgradePlan<undefined>;
    code: string;
  }[] = [
    {
      state: { current_version: 1, pending_transition: null },
      plan: plan(2, [], { baseline_version: 2 }),
      code: "unsupported_version",
    },
    {
      state: {
        current_version: 1,
        pending_transition: {
          step_id: "removed-helper",
          from_version: 1,
          to_version: 2,
        },
      },
      plan: plan(2, [() => undefined]),
      code: "unknown_pending_transition",
    },
    {
      state: {
        current_version: 0,
        pending_transition: null,
      },
      plan: plan(1, []),
      code: "invalid_state",
    },
  ];

  for (const test_case of cases) {
    const repository = new MemorySchemaUpgradeStateRepository();
    repository.seed("pages", test_case.state);
    const upgrader = new ForwardDatabaseSchemaUpgrader<undefined>({
      state_repository: repository,
      plans: [test_case.plan],
    });
    const error = await assertRejects(() => upgrader.upgrade(undefined));
    assertInstanceOf(error, SchemaUpgradeError);
    assertEquals(error.code, test_case.code);
    assertEquals(repository.write_count, 0);
  }
});
