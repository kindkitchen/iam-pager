import { SchemaUpgradeError } from "./errors.ts";
import type {
  DatabaseSchemaCheckOutcome,
  DatabaseSchemaCheckReport,
  DatabaseSchemaManifestRepository,
  DatabaseSchemaVersionChecker,
  DatabaseSchemaVersionOutcome,
  DatabaseSchemaVersionReport,
  SchemaUpgradePlan,
  SchemaUpgradeState,
  SchemaUpgradeStateRepository,
} from "./interfaces.ts";
import { define_database_schema_manifest } from "./manifest.ts";
import {
  define_schema_upgrade_plans,
  is_schema_upgrade_identifier,
  is_schema_upgrade_version,
} from "./plan.ts";

export interface ExactDatabaseSchemaVersionCheckerOptions<Context> {
  readonly project_id: string;
  readonly manifest_repository: DatabaseSchemaManifestRepository;
  readonly state_repository: SchemaUpgradeStateRepository;
  readonly plans: readonly SchemaUpgradePlan<Context>[];
}

const outcome_priority: Readonly<Record<DatabaseSchemaVersionOutcome, number>> =
  {
    current: 0,
    stale: 1,
    pending: 2,
    future: 3,
    unversioned: 4,
  };

function overall_outcome(
  schemas: readonly DatabaseSchemaVersionReport[],
): DatabaseSchemaCheckOutcome {
  let outcome: DatabaseSchemaVersionOutcome = "current";
  for (const schema of schemas) {
    if (outcome_priority[schema.outcome] > outcome_priority[outcome]) {
      outcome = schema.outcome;
    }
  }
  return outcome;
}

function valid_state(state: SchemaUpgradeState): boolean {
  if (!is_schema_upgrade_version(state.current_version)) return false;
  const pending = state.pending_transition;
  return pending === null ||
    (
      is_schema_upgrade_identifier(pending.step_id) &&
      is_schema_upgrade_version(pending.from_version) &&
      is_schema_upgrade_version(pending.to_version) &&
      pending.from_version === state.current_version &&
      pending.to_version === pending.from_version + 1
    );
}

/** Read-only exact project and schema compatibility gate. */
export class ExactDatabaseSchemaVersionChecker
  implements DatabaseSchemaVersionChecker {
  readonly #project_id: string;
  readonly #manifest_repository: DatabaseSchemaManifestRepository;
  readonly #state_repository: SchemaUpgradeStateRepository;
  readonly #plans: readonly SchemaUpgradePlan<unknown>[];

  constructor(options: ExactDatabaseSchemaVersionCheckerOptions<unknown>) {
    if (!is_schema_upgrade_identifier(options.project_id)) {
      throw new SchemaUpgradeError("invalid_plan");
    }
    this.#project_id = options.project_id;
    this.#manifest_repository = options.manifest_repository;
    this.#state_repository = options.state_repository;
    this.#plans = define_schema_upgrade_plans(options.plans);
  }

  async check(): Promise<DatabaseSchemaCheckReport> {
    let supplied_manifest;
    try {
      supplied_manifest = await this.#manifest_repository.read_manifest();
    } catch (error) {
      if (error instanceof SchemaUpgradeError) throw error;
      throw new SchemaUpgradeError("manifest_repository_failed");
    }

    if (supplied_manifest === null) {
      return Object.freeze({
        project_id: this.#project_id,
        outcome: "unversioned",
        schemas: Object.freeze(this.#plans.map((plan) =>
          Object.freeze({
            schema_id: plan.schema_id,
            version: 0,
            target_version: plan.target_version,
            outcome: "unversioned" as const,
          })
        )),
      });
    }

    const manifest = define_database_schema_manifest(supplied_manifest);
    if (manifest.project_id !== this.#project_id) {
      return Object.freeze({
        project_id: this.#project_id,
        outcome: "wrong_project",
        schemas: Object.freeze([]),
      });
    }

    const manifest_versions = new Map(
      manifest.schema_versions.map((version) => [
        version.schema_id,
        version.version,
      ]),
    );
    const plan_ids = new Set(this.#plans.map((plan) => plan.schema_id));
    const schemas: DatabaseSchemaVersionReport[] = [];

    for (const plan of this.#plans) {
      const published_version = manifest_versions.get(plan.schema_id) ?? 0;
      const state = await this.#read_state(plan.schema_id);
      let outcome: DatabaseSchemaVersionOutcome;
      if (published_version > plan.target_version) {
        outcome = "future";
      } else if (
        state?.current_version !== undefined &&
        state.current_version > plan.target_version
      ) {
        outcome = "future";
      } else if (
        state?.pending_transition !== null &&
        state?.pending_transition !== undefined
      ) {
        outcome = "pending";
      } else if (
        published_version < plan.target_version || state === null ||
        state.current_version !== published_version
      ) {
        outcome = "stale";
      } else {
        outcome = "current";
      }
      schemas.push(Object.freeze({
        schema_id: plan.schema_id,
        version: published_version,
        target_version: plan.target_version,
        outcome,
      }));
    }

    for (const version of manifest.schema_versions) {
      if (plan_ids.has(version.schema_id)) continue;
      schemas.push(Object.freeze({
        schema_id: version.schema_id,
        version: version.version,
        target_version: 0,
        outcome: "future",
      }));
    }
    schemas.sort((left, right) =>
      left.schema_id.localeCompare(right.schema_id)
    );

    return Object.freeze({
      project_id: this.#project_id,
      outcome: overall_outcome(schemas),
      schemas: Object.freeze(schemas),
    });
  }

  async #read_state(schema_id: string): Promise<SchemaUpgradeState | null> {
    let state: SchemaUpgradeState | null;
    try {
      state = await this.#state_repository.read_state(schema_id);
    } catch (error) {
      if (error instanceof SchemaUpgradeError) throw error;
      throw new SchemaUpgradeError("state_repository_failed", { schema_id });
    }
    if (state !== null && !valid_state(state)) {
      throw new SchemaUpgradeError("invalid_state", { schema_id });
    }
    return state;
  }
}
