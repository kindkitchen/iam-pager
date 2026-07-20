import { SchemaUpgradeError } from "./errors.ts";
import type {
  DatabaseSchemaUpgrader,
  DatabaseSchemaUpgradeReport,
  SchemaUpgradePlan,
  SchemaUpgradeReport,
  SchemaUpgradeState,
  SchemaUpgradeStateMutationResult,
  SchemaUpgradeStateRepository,
  SchemaUpgradeStep,
  SchemaUpgradeTransition,
  SchemaUpgradeTransitionReport,
} from "./interfaces.ts";
import {
  define_schema_upgrade_plans,
  is_schema_upgrade_identifier,
  is_schema_upgrade_version,
} from "./plan.ts";

const default_max_coordination_conflicts = 1024;

export interface ForwardDatabaseSchemaUpgraderOptions<Context> {
  readonly state_repository: SchemaUpgradeStateRepository;
  readonly plans: readonly SchemaUpgradePlan<Context>[];
  readonly max_coordination_conflicts?: number;
}

function transition_equals(
  left: SchemaUpgradeTransition,
  right: SchemaUpgradeTransition,
): boolean {
  return left.step_id === right.step_id &&
    left.from_version === right.from_version &&
    left.to_version === right.to_version;
}

function invalid_state(schema_id: string): never {
  throw new SchemaUpgradeError("invalid_state", { schema_id });
}

function normalize_state<Context>(
  plan: SchemaUpgradePlan<Context>,
  supplied_state: SchemaUpgradeState,
): SchemaUpgradeState {
  if (
    supplied_state === null || typeof supplied_state !== "object" ||
    !is_schema_upgrade_version(supplied_state.current_version) ||
    !("pending_transition" in supplied_state)
  ) {
    invalid_state(plan.schema_id);
  }

  const supplied_transition = supplied_state.pending_transition;
  let pending_transition: SchemaUpgradeTransition | null = null;
  if (supplied_transition !== null) {
    if (
      typeof supplied_transition !== "object" ||
      !is_schema_upgrade_identifier(supplied_transition.step_id) ||
      !is_schema_upgrade_version(supplied_transition.from_version) ||
      !is_schema_upgrade_version(supplied_transition.to_version) ||
      supplied_transition.from_version !== supplied_state.current_version ||
      supplied_transition.to_version !== supplied_transition.from_version + 1
    ) {
      invalid_state(plan.schema_id);
    }
    pending_transition = Object.freeze({
      step_id: supplied_transition.step_id,
      from_version: supplied_transition.from_version,
      to_version: supplied_transition.to_version,
    });
  }

  const state = Object.freeze({
    current_version: supplied_state.current_version,
    pending_transition,
  });
  assert_state_supported(plan, state);
  return state;
}

function step_from_version<Context>(
  plan: SchemaUpgradePlan<Context>,
  from_version: number,
): SchemaUpgradeStep<Context> | undefined {
  return plan.steps[from_version - plan.baseline_version];
}

function assert_state_supported<Context>(
  plan: SchemaUpgradePlan<Context>,
  state: SchemaUpgradeState,
): void {
  if (state.current_version < plan.baseline_version) {
    throw new SchemaUpgradeError("unsupported_version", {
      schema_id: plan.schema_id,
      from_version: state.current_version,
      to_version: plan.target_version,
    });
  }
  if (state.current_version > plan.target_version) {
    throw new SchemaUpgradeError("future_version", {
      schema_id: plan.schema_id,
      from_version: state.current_version,
      to_version: plan.target_version,
    });
  }

  if (state.pending_transition !== null) {
    const expected_step = step_from_version(plan, state.current_version);
    if (
      expected_step === undefined ||
      !transition_equals(expected_step, state.pending_transition)
    ) {
      throw new SchemaUpgradeError("unknown_pending_transition", {
        schema_id: plan.schema_id,
        step_id: state.pending_transition.step_id,
        from_version: state.pending_transition.from_version,
        to_version: state.pending_transition.to_version,
      });
    }
  }
}

function assert_state_progressed(
  schema_id: string,
  previous_state: SchemaUpgradeState | null,
  next_state: SchemaUpgradeState | null,
): void {
  if (previous_state === null) return;
  if (
    next_state === null ||
    next_state.current_version < previous_state.current_version
  ) {
    invalid_state(schema_id);
  }
  if (
    next_state.current_version === previous_state.current_version &&
    previous_state.pending_transition !== null &&
    (
      next_state.pending_transition === null ||
      !transition_equals(
        previous_state.pending_transition,
        next_state.pending_transition,
      )
    )
  ) {
    invalid_state(schema_id);
  }
}

function transition_details(
  schema_id: string,
  transition: SchemaUpgradeTransition,
) {
  return {
    schema_id,
    step_id: transition.step_id,
    from_version: transition.from_version,
    to_version: transition.to_version,
  } as const;
}

/**
 * Storage-neutral forward runner. All plans and all initial durable states are
 * preflighted before the first metadata write.
 */
export class ForwardDatabaseSchemaUpgrader<Context>
  implements DatabaseSchemaUpgrader<Context> {
  readonly #state_repository: SchemaUpgradeStateRepository;
  readonly #plans: readonly SchemaUpgradePlan<Context>[];
  readonly #max_coordination_conflicts: number;

  constructor(options: ForwardDatabaseSchemaUpgraderOptions<Context>) {
    this.#state_repository = options.state_repository;
    this.#plans = define_schema_upgrade_plans(options.plans);
    const max_coordination_conflicts = options.max_coordination_conflicts ??
      default_max_coordination_conflicts;
    if (
      !Number.isSafeInteger(max_coordination_conflicts) ||
      max_coordination_conflicts < 1
    ) {
      throw new SchemaUpgradeError("invalid_plan");
    }
    this.#max_coordination_conflicts = max_coordination_conflicts;
  }

  async upgrade(context: Context): Promise<DatabaseSchemaUpgradeReport> {
    const preflight_states: (SchemaUpgradeState | null)[] = [];
    for (const plan of this.#plans) {
      preflight_states.push(await this.#read_state(plan));
    }

    const schemas: SchemaUpgradeReport[] = [];
    for (let index = 0; index < this.#plans.length; index += 1) {
      schemas.push(
        await this.#upgrade_schema(
          this.#plans[index],
          preflight_states[index],
          context,
        ),
      );
    }
    return Object.freeze({ schemas: Object.freeze(schemas) });
  }

  async #upgrade_schema(
    plan: SchemaUpgradePlan<Context>,
    initial_state: SchemaUpgradeState | null,
    context: Context,
  ): Promise<SchemaUpgradeReport> {
    let state = initial_state;
    const initial_version = state?.current_version ?? plan.baseline_version;
    const claimed_step_ids = new Set<string>();
    const transition_reports = new Map<
      string,
      SchemaUpgradeTransitionReport
    >();
    let coordination_conflicts = 0;

    const note_conflict = () => {
      coordination_conflicts += 1;
      if (coordination_conflicts > this.#max_coordination_conflicts) {
        throw new SchemaUpgradeError("coordination_conflict", {
          schema_id: plan.schema_id,
        });
      }
    };

    while (true) {
      if (state === null) {
        const initialization = await this.#mutate_state(
          plan.schema_id,
          () =>
            this.#state_repository.initialize_state({
              schema_id: plan.schema_id,
              baseline_version: plan.baseline_version,
            }),
        );
        if (initialization === "applied") {
          state = Object.freeze({
            current_version: plan.baseline_version,
            pending_transition: null,
          });
        } else {
          note_conflict();
          state = await this.#read_state_after_conflict(plan, state);
        }
        continue;
      }

      if (state.pending_transition !== null) {
        const transition = state.pending_transition;
        const step = step_from_version(plan, state.current_version);
        if (step === undefined || !transition_equals(step, transition)) {
          throw new SchemaUpgradeError(
            "unknown_pending_transition",
            transition_details(plan.schema_id, transition),
          );
        }

        const execution = claimed_step_ids.has(step.step_id)
          ? "upgraded"
          : "resumed";
        try {
          await step.upgrade(context);
        } catch {
          throw new SchemaUpgradeError(
            "step_failed",
            transition_details(plan.schema_id, step),
          );
        }

        const existing_report = transition_reports.get(step.step_id);
        if (existing_report === undefined || execution === "resumed") {
          transition_reports.set(
            step.step_id,
            Object.freeze({
              step_id: step.step_id,
              from_version: step.from_version,
              to_version: step.to_version,
              execution,
            }),
          );
        }

        const completion = await this.#mutate_state(
          plan.schema_id,
          () =>
            this.#state_repository.complete_transition({
              schema_id: plan.schema_id,
              transition,
            }),
        );
        if (completion === "applied") {
          state = Object.freeze({
            current_version: transition.to_version,
            pending_transition: null,
          });
        } else {
          note_conflict();
          state = await this.#read_state_after_conflict(plan, state);
        }
        continue;
      }

      if (state.current_version === plan.target_version) break;

      const step = step_from_version(plan, state.current_version);
      if (step === undefined) invalid_state(plan.schema_id);
      const transition = Object.freeze({
        step_id: step.step_id,
        from_version: step.from_version,
        to_version: step.to_version,
      });
      const claim = await this.#mutate_state(
        plan.schema_id,
        () =>
          this.#state_repository.claim_transition({
            schema_id: plan.schema_id,
            expected_current_version: transition.from_version,
            transition,
          }),
      );
      if (claim === "applied") {
        claimed_step_ids.add(step.step_id);
        state = Object.freeze({
          current_version: transition.from_version,
          pending_transition: transition,
        });
      } else {
        note_conflict();
        state = await this.#read_state_after_conflict(plan, state);
      }
    }

    const transitions = Object.freeze([...transition_reports.values()]);
    const outcome = transitions.length === 0
      ? "no_change"
      : transitions.some((transition) => transition.execution === "resumed")
      ? "resumed"
      : "upgraded";
    return Object.freeze({
      schema_id: plan.schema_id,
      initial_version,
      target_version: plan.target_version,
      outcome,
      transitions,
    });
  }

  async #read_state(
    plan: SchemaUpgradePlan<Context>,
  ): Promise<SchemaUpgradeState | null> {
    let supplied_state: SchemaUpgradeState | null;
    try {
      supplied_state = await this.#state_repository.read_state(plan.schema_id);
    } catch (error) {
      if (error instanceof SchemaUpgradeError) throw error;
      throw new SchemaUpgradeError("state_repository_failed", {
        schema_id: plan.schema_id,
      });
    }
    return supplied_state === null
      ? null
      : normalize_state(plan, supplied_state);
  }

  async #read_state_after_conflict(
    plan: SchemaUpgradePlan<Context>,
    previous_state: SchemaUpgradeState | null,
  ): Promise<SchemaUpgradeState | null> {
    const next_state = await this.#read_state(plan);
    assert_state_progressed(plan.schema_id, previous_state, next_state);
    return next_state;
  }

  async #mutate_state(
    schema_id: string,
    operation: () => Promise<SchemaUpgradeStateMutationResult>,
  ): Promise<SchemaUpgradeStateMutationResult> {
    let result: SchemaUpgradeStateMutationResult;
    try {
      result = await operation();
    } catch (error) {
      if (error instanceof SchemaUpgradeError) throw error;
      throw new SchemaUpgradeError("state_repository_failed", { schema_id });
    }
    if (result !== "applied" && result !== "conflict") {
      throw new SchemaUpgradeError("state_repository_failed", { schema_id });
    }
    return result;
  }
}
