import {
  DenoKvDatabaseOpener,
  type KvDatabaseOpener,
  parse_ownership_storage_config,
  parse_page_storage_config,
  parse_session_storage_config,
} from "../storage/mod.ts";
import { ExactDatabaseSchemaVersionChecker } from "./checker.ts";
import {
  current_database_schema_upgrade_plans,
  database_schema_project_id,
  type DenoKvSchemaUpgradeContext,
} from "./current-plans.ts";
import { DenoKvDatabaseSchemaManifestRepository } from "./deno-kv-manifest-repository.ts";
import { DenoKvSchemaUpgradeStateRepository } from "./deno-kv-state-repository.ts";
import { SchemaUpgradeError } from "./errors.ts";
import type {
  DatabaseSchemaCheckReport,
  DatabaseSchemaManifestRepository,
  SchemaUpgradePlan,
  SchemaUpgradeStateRepository,
} from "./interfaces.ts";
import { define_schema_upgrade_plans } from "./plan.ts";

export interface DatabaseSchemaEnvironmentSource {
  get(name: string): string | undefined;
}

export type DatabaseSchemaStorageConfig =
  | { readonly backend: "memory" }
  | { readonly backend: "deno-kv"; readonly path?: string };

export interface DatabaseSchemaConnection {
  readonly context: DenoKvSchemaUpgradeContext;
  readonly manifest_repository: DatabaseSchemaManifestRepository;
  readonly state_repository: SchemaUpgradeStateRepository;
  close(): void | Promise<void>;
}

export interface DatabaseSchemaConnectionFactory {
  open(path?: string): Promise<DatabaseSchemaConnection>;
}

export class DenoKvDatabaseSchemaConnectionFactory
  implements DatabaseSchemaConnectionFactory {
  readonly #kv_opener: KvDatabaseOpener;

  constructor(options: { kv_opener?: KvDatabaseOpener } = {}) {
    this.#kv_opener = options.kv_opener ?? new DenoKvDatabaseOpener();
  }

  async open(path?: string): Promise<DatabaseSchemaConnection> {
    let kv: Deno.Kv;
    try {
      kv = await this.#kv_opener.open(path);
    } catch {
      throw new SchemaUpgradeError("database_unavailable");
    }
    return {
      context: Object.freeze({ kv }),
      manifest_repository: new DenoKvDatabaseSchemaManifestRepository(kv),
      state_repository: new DenoKvSchemaUpgradeStateRepository(kv),
      close: () => kv.close(),
    };
  }
}

/** Reuses application storage validation without loading web/auth composition. */
export function parse_database_schema_storage_config(
  environment: DatabaseSchemaEnvironmentSource,
): DatabaseSchemaStorageConfig {
  try {
    const ownership_config = parse_ownership_storage_config(environment);
    const session_config = parse_session_storage_config(
      environment,
      ownership_config,
    );
    const page_config = parse_page_storage_config(
      environment,
      ownership_config,
    );
    if (
      session_config.backend !== ownership_config.backend ||
      page_config.backend !== ownership_config.backend
    ) {
      throw new TypeError(
        "database schema checks require one consistent storage backend",
      );
    }
    return ownership_config.backend === "memory"
      ? { backend: "memory" }
      : ownership_config.path === undefined
      ? { backend: "deno-kv" }
      : { backend: "deno-kv", path: ownership_config.path };
  } catch {
    throw new SchemaUpgradeError("invalid_configuration");
  }
}

export interface ExecuteDatabaseSchemaCheckOptions {
  readonly database_factory?: DatabaseSchemaConnectionFactory;
  readonly plans?: readonly SchemaUpgradePlan<DenoKvSchemaUpgradeContext>[];
  readonly project_id?: string;
}

/** Opens the timeline database and performs no mutation. */
export async function execute_database_schema_check(
  environment: DatabaseSchemaEnvironmentSource,
  options: ExecuteDatabaseSchemaCheckOptions = {},
): Promise<DatabaseSchemaCheckReport> {
  const config = parse_database_schema_storage_config(environment);
  if (config.backend === "memory") {
    throw new SchemaUpgradeError("invalid_configuration");
  }
  const plans = define_schema_upgrade_plans(
    options.plans ?? current_database_schema_upgrade_plans,
  );
  const database_factory = options.database_factory ??
    new DenoKvDatabaseSchemaConnectionFactory();
  let database: DatabaseSchemaConnection;
  try {
    database = await database_factory.open(config.path);
  } catch (error) {
    if (error instanceof SchemaUpgradeError) throw error;
    throw new SchemaUpgradeError("database_unavailable");
  }

  let failed = false;
  let failure: unknown;
  let report: DatabaseSchemaCheckReport | undefined;
  try {
    const checker = new ExactDatabaseSchemaVersionChecker({
      project_id: options.project_id ?? database_schema_project_id,
      manifest_repository: database.manifest_repository,
      state_repository: database.state_repository,
      plans,
    });
    report = await checker.check();
  } catch (error) {
    failed = true;
    failure = error;
  }

  try {
    await database.close();
  } catch {
    if (!failed) {
      failed = true;
      failure = new SchemaUpgradeError("database_close_failed");
    }
  }
  if (failed) throw failure;
  if (report === undefined) {
    throw new SchemaUpgradeError("state_repository_failed");
  }
  return report;
}

export interface DatabaseSchemaOutput {
  log(line: string): void;
  error(line: string): void;
}

export class ConsoleDatabaseSchemaOutput implements DatabaseSchemaOutput {
  log(line: string): void {
    console.log(line);
  }

  error(line: string): void {
    console.error(line);
  }
}

export function safe_schema_error_line(error: unknown): string {
  if (!(error instanceof SchemaUpgradeError)) {
    return "database-schema failed code=unexpected";
  }
  const fields = [`database-schema failed code=${error.code}`];
  if (error.project_id !== undefined) {
    fields.push(`project=${error.project_id}`);
  }
  if (error.schema_id !== undefined) fields.push(`schema=${error.schema_id}`);
  if (error.step_id !== undefined) fields.push(`step=${error.step_id}`);
  if (error.from_version !== undefined) {
    fields.push(`from=${error.from_version}`);
  }
  if (error.to_version !== undefined) fields.push(`to=${error.to_version}`);
  return fields.join(" ");
}

export function write_schema_check_report(
  output: DatabaseSchemaOutput,
  report: DatabaseSchemaCheckReport,
): void {
  const write = report.outcome === "current"
    ? output.log.bind(output)
    : output.error.bind(output);
  for (const schema of report.schemas) {
    write(
      `database-schema project=${report.project_id} schema=${schema.schema_id} current=${schema.version} target=${schema.target_version} outcome=${schema.outcome}`,
    );
  }
  write(
    `database-schema check project=${report.project_id} outcome=${report.outcome}`,
  );
}

export async function run_database_schema_check_cli(
  environment: DatabaseSchemaEnvironmentSource,
  output: DatabaseSchemaOutput = new ConsoleDatabaseSchemaOutput(),
  options: ExecuteDatabaseSchemaCheckOptions = {},
): Promise<number> {
  try {
    const report = await execute_database_schema_check(environment, options);
    write_schema_check_report(output, report);
    return report.outcome === "current" ? 0 : 1;
  } catch (error) {
    output.error(safe_schema_error_line(error));
    return 1;
  }
}
