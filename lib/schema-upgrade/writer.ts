import { SchemaUpgradeError } from "./errors.ts";
import type {
  DatabaseSchemaManifest,
  DatabaseSchemaManifestRepository,
  DatabaseSchemaWriter,
  DatabaseSchemaWriteReport,
  DatabaseSchemaWriteRequest,
  SchemaUpgradePlan,
  SchemaUpgradeStateMutationResult,
  SchemaUpgradeStateRepository,
} from "./interfaces.ts";
import {
  database_schema_manifests_equal,
  database_schema_versions_equal,
  define_database_schema_manifest,
  define_database_schema_versions,
} from "./manifest.ts";
import {
  define_schema_upgrade_plans,
  is_schema_upgrade_identifier,
} from "./plan.ts";
import { ForwardDatabaseSchemaUpgrader } from "./upgrader.ts";

export interface GuardedDatabaseSchemaWriterOptions<Context> {
  readonly project_id: string;
  readonly manifest_repository: DatabaseSchemaManifestRepository;
  readonly state_repository: SchemaUpgradeStateRepository;
  readonly plans: readonly SchemaUpgradePlan<Context>[];
}

/**
 * Validates explicit project/from/to intent before delegating any write to the
 * existing forward-only runner, then publishes the target manifest last.
 */
export class GuardedDatabaseSchemaWriter<Context>
  implements DatabaseSchemaWriter<Context> {
  readonly #project_id: string;
  readonly #manifest_repository: DatabaseSchemaManifestRepository;
  readonly #state_repository: SchemaUpgradeStateRepository;
  readonly #plans: readonly SchemaUpgradePlan<Context>[];

  constructor(options: GuardedDatabaseSchemaWriterOptions<Context>) {
    if (!is_schema_upgrade_identifier(options.project_id)) {
      throw new SchemaUpgradeError("invalid_plan");
    }
    this.#project_id = options.project_id;
    this.#manifest_repository = options.manifest_repository;
    this.#state_repository = options.state_repository;
    this.#plans = define_schema_upgrade_plans(options.plans);
  }

  async write(
    supplied_request: DatabaseSchemaWriteRequest,
    context: Context,
  ): Promise<DatabaseSchemaWriteReport> {
    const request = this.#define_request(supplied_request);
    if (request.project_id !== this.#project_id) {
      throw new SchemaUpgradeError("wrong_project", {
        project_id: this.#project_id,
      });
    }

    const current_manifest = await this.#read_manifest();
    if (current_manifest === null) {
      if (!request.from_versions.every((version) => version.version === 0)) {
        throw new SchemaUpgradeError("version_mismatch", {
          project_id: this.#project_id,
        });
      }
    } else {
      if (current_manifest.project_id !== this.#project_id) {
        throw new SchemaUpgradeError("wrong_project", {
          project_id: this.#project_id,
        });
      }
      if (
        !database_schema_versions_equal(
          current_manifest.schema_versions,
          request.from_versions,
        )
      ) {
        throw new SchemaUpgradeError("version_mismatch", {
          project_id: this.#project_id,
        });
      }
    }

    const upgrader = new ForwardDatabaseSchemaUpgrader({
      state_repository: this.#state_repository,
      plans: this.#plans,
    });
    const upgrade = await upgrader.upgrade(context);
    const target_manifest = define_database_schema_manifest({
      project_id: this.#project_id,
      schema_versions: request.to_versions,
    });

    if (
      current_manifest === null ||
      !database_schema_manifests_equal(current_manifest, target_manifest)
    ) {
      const publication = current_manifest === null
        ? await this.#mutate_manifest(() =>
          this.#manifest_repository.initialize_manifest(target_manifest)
        )
        : await this.#mutate_manifest(() =>
          this.#manifest_repository.replace_manifest({
            expected_manifest: current_manifest,
            manifest: target_manifest,
          })
        );
      if (publication === "conflict") {
        const concurrent_manifest = await this.#read_manifest();
        if (
          concurrent_manifest === null ||
          !database_schema_manifests_equal(
            concurrent_manifest,
            target_manifest,
          )
        ) {
          throw new SchemaUpgradeError("manifest_conflict", {
            project_id: this.#project_id,
          });
        }
      }
    }

    return Object.freeze({
      project_id: this.#project_id,
      from_versions: request.from_versions,
      to_versions: request.to_versions,
      upgrade,
    });
  }

  #define_request(
    supplied_request: DatabaseSchemaWriteRequest,
  ): DatabaseSchemaWriteRequest {
    if (
      supplied_request === null || typeof supplied_request !== "object" ||
      !is_schema_upgrade_identifier(supplied_request.project_id)
    ) {
      throw new SchemaUpgradeError("invalid_request");
    }
    const from_versions = define_database_schema_versions(
      supplied_request.from_versions,
      { allow_zero: true, error_code: "invalid_request" },
    );
    const to_versions = define_database_schema_versions(
      supplied_request.to_versions,
      { error_code: "invalid_request" },
    );
    const targets = define_database_schema_versions(this.#plans.map((plan) => ({
      schema_id: plan.schema_id,
      version: plan.target_version,
    })));
    if (
      from_versions.length !== targets.length ||
      !from_versions.every((version, index) =>
        version.schema_id === targets[index].schema_id
      ) ||
      !database_schema_versions_equal(to_versions, targets)
    ) {
      throw new SchemaUpgradeError("invalid_request", {
        project_id: this.#project_id,
      });
    }
    const zero_count = from_versions.filter((version) => version.version === 0)
      .length;
    if (zero_count !== 0 && zero_count !== from_versions.length) {
      throw new SchemaUpgradeError("invalid_request", {
        project_id: this.#project_id,
      });
    }
    return Object.freeze({
      project_id: supplied_request.project_id,
      from_versions,
      to_versions,
    });
  }

  async #read_manifest(): Promise<DatabaseSchemaManifest | null> {
    let manifest: DatabaseSchemaManifest | null;
    try {
      manifest = await this.#manifest_repository.read_manifest();
    } catch (error) {
      if (error instanceof SchemaUpgradeError) throw error;
      throw new SchemaUpgradeError("manifest_repository_failed");
    }
    return manifest === null ? null : define_database_schema_manifest(manifest);
  }

  async #mutate_manifest(
    operation: () => Promise<SchemaUpgradeStateMutationResult>,
  ): Promise<SchemaUpgradeStateMutationResult> {
    let result: SchemaUpgradeStateMutationResult;
    try {
      result = await operation();
    } catch (error) {
      if (error instanceof SchemaUpgradeError) throw error;
      throw new SchemaUpgradeError("manifest_repository_failed");
    }
    if (result !== "applied" && result !== "conflict") {
      throw new SchemaUpgradeError("manifest_repository_failed");
    }
    return result;
  }
}
