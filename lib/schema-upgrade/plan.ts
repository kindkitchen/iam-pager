import { SchemaUpgradeError } from "./errors.ts";
import type { SchemaUpgradePlan, SchemaUpgradeStep } from "./interfaces.ts";

export const max_schema_upgrade_plans = 64;
export const max_schema_upgrade_steps_per_plan = 256;
export const max_schema_upgrade_identifier_length = 80;

const identifier_pattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function is_schema_upgrade_identifier(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= max_schema_upgrade_identifier_length &&
    identifier_pattern.test(value);
}

export function is_schema_upgrade_version(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function invalid_plan(): never {
  throw new SchemaUpgradeError("invalid_plan");
}

/**
 * Validates and snapshots a registry so later caller mutation cannot reorder a
 * retained helper or alter the path after validation.
 */
export function define_schema_upgrade_plans<Context>(
  supplied_plans: readonly SchemaUpgradePlan<Context>[],
): readonly SchemaUpgradePlan<Context>[] {
  if (
    !Array.isArray(supplied_plans) ||
    supplied_plans.length > max_schema_upgrade_plans
  ) {
    invalid_plan();
  }

  const schema_ids = new Set<string>();
  const plans: SchemaUpgradePlan<Context>[] = [];

  for (const supplied_plan of supplied_plans) {
    if (
      supplied_plan === null || typeof supplied_plan !== "object" ||
      !is_schema_upgrade_identifier(supplied_plan.schema_id) ||
      schema_ids.has(supplied_plan.schema_id) ||
      !is_schema_upgrade_version(supplied_plan.baseline_version) ||
      !is_schema_upgrade_version(supplied_plan.target_version) ||
      supplied_plan.target_version < supplied_plan.baseline_version ||
      !Array.isArray(supplied_plan.steps) ||
      supplied_plan.steps.length > max_schema_upgrade_steps_per_plan ||
      supplied_plan.target_version - supplied_plan.baseline_version !==
        supplied_plan.steps.length
    ) {
      invalid_plan();
    }

    schema_ids.add(supplied_plan.schema_id);
    const step_ids = new Set<string>();
    const steps: SchemaUpgradeStep<Context>[] = [];

    for (let index = 0; index < supplied_plan.steps.length; index += 1) {
      const supplied_step = supplied_plan.steps[index];
      const expected_from_version = supplied_plan.baseline_version + index;
      if (
        supplied_step === null || typeof supplied_step !== "object" ||
        !is_schema_upgrade_identifier(supplied_step.step_id) ||
        step_ids.has(supplied_step.step_id) ||
        supplied_step.from_version !== expected_from_version ||
        supplied_step.to_version !== expected_from_version + 1 ||
        typeof supplied_step.upgrade !== "function"
      ) {
        invalid_plan();
      }

      step_ids.add(supplied_step.step_id);
      steps.push(Object.freeze({
        step_id: supplied_step.step_id,
        from_version: supplied_step.from_version,
        to_version: supplied_step.to_version,
        upgrade: supplied_step.upgrade,
      }));
    }

    plans.push(Object.freeze({
      schema_id: supplied_plan.schema_id,
      baseline_version: supplied_plan.baseline_version,
      target_version: supplied_plan.target_version,
      steps: Object.freeze(steps),
    }));
  }

  return Object.freeze(plans);
}
