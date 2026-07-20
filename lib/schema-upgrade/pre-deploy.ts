import {
  DenoKvDatabaseOpener,
  type KvDatabaseOpener,
  parse_ownership_storage_config,
  parse_page_storage_config,
  parse_session_storage_config,
} from "../storage/mod.ts";
import {
  current_database_schema_upgrade_plans,
  type DenoKvSchemaUpgradeContext,
} from "./current-plans.ts";
import { DenoKvSchemaUpgradeStateRepository } from "./deno-kv-state-repository.ts";
import { SchemaUpgradeError } from "./errors.ts";
import type {
  DatabaseSchemaUpgradeReport,
  SchemaUpgradePlan,
  SchemaUpgradeStateRepository,
} from "./interfaces.ts";
import { define_schema_upgrade_plans } from "./plan.ts";
import { ForwardDatabaseSchemaUpgrader } from "./upgrader.ts";

export interface DatabaseSchemaUpgradeEnvironmentSource {
  get(name: string): string | undefined;
}

export type DatabaseSchemaUpgradeStorageConfig =
  | { readonly backend: "memory" }
  | { readonly backend: "deno-kv"; readonly path?: string };

export interface DatabaseSchemaUpgradeConnection {
  readonly context: DenoKvSchemaUpgradeContext;
  readonly state_repository: SchemaUpgradeStateRepository;
  close(): void | Promise<void>;
}

export interface DatabaseSchemaUpgradeConnectionFactory {
  open(path?: string): Promise<DatabaseSchemaUpgradeConnection>;
}

export class DenoKvSchemaUpgradeConnectionFactory
  implements DatabaseSchemaUpgradeConnectionFactory {
  readonly #kv_opener: KvDatabaseOpener;

  constructor(options: { kv_opener?: KvDatabaseOpener } = {}) {
    this.#kv_opener = options.kv_opener ?? new DenoKvDatabaseOpener();
  }

  async open(path?: string): Promise<DatabaseSchemaUpgradeConnection> {
    let kv: Deno.Kv;
    try {
      kv = await this.#kv_opener.open(path);
    } catch {
      throw new SchemaUpgradeError("database_unavailable");
    }
    return {
      context: Object.freeze({ kv }),
      state_repository: new DenoKvSchemaUpgradeStateRepository(kv),
      close: () => kv.close(),
    };
  }
}

/** Reuses application storage validation without loading web/auth composition. */
export function parse_database_schema_upgrade_storage_config(
  environment: DatabaseSchemaUpgradeEnvironmentSource,
): DatabaseSchemaUpgradeStorageConfig {
  try {
    const ownership_config = parse_ownership_storage_config(environment);
    // Validate linked selections even though ownership owns the shared KV path.
    parse_session_storage_config(environment, ownership_config);
    parse_page_storage_config(environment, ownership_config);
    return ownership_config.backend === "memory"
      ? { backend: "memory" }
      : ownership_config.path === undefined
      ? { backend: "deno-kv" }
      : { backend: "deno-kv", path: ownership_config.path };
  } catch {
    throw new SchemaUpgradeError("invalid_configuration");
  }
}

export type DatabaseSchemaUpgradeExecution =
  | { readonly storage: "memory" }
  | {
    readonly storage: "deno-kv";
    readonly report: DatabaseSchemaUpgradeReport;
  };

export interface ExecuteDatabaseSchemaUpgradeOptions {
  readonly database_factory?: DatabaseSchemaUpgradeConnectionFactory;
  readonly plans?: readonly SchemaUpgradePlan<DenoKvSchemaUpgradeContext>[];
}

export async function execute_database_schema_upgrade(
  environment: DatabaseSchemaUpgradeEnvironmentSource,
  options: ExecuteDatabaseSchemaUpgradeOptions = {},
): Promise<DatabaseSchemaUpgradeExecution> {
  const config = parse_database_schema_upgrade_storage_config(environment);
  const plans = define_schema_upgrade_plans(
    options.plans ?? current_database_schema_upgrade_plans,
  );
  if (config.backend === "memory") return Object.freeze({ storage: "memory" });

  const database_factory = options.database_factory ??
    new DenoKvSchemaUpgradeConnectionFactory();
  let database: DatabaseSchemaUpgradeConnection;
  try {
    database = await database_factory.open(config.path);
  } catch (error) {
    if (error instanceof SchemaUpgradeError) throw error;
    throw new SchemaUpgradeError("database_unavailable");
  }

  let execution_failed = false;
  let execution_error: unknown;
  let report: DatabaseSchemaUpgradeReport | undefined;
  try {
    const upgrader = new ForwardDatabaseSchemaUpgrader({
      state_repository: database.state_repository,
      plans,
    });
    report = await upgrader.upgrade(database.context);
  } catch (error) {
    execution_failed = true;
    execution_error = error;
  }

  try {
    await database.close();
  } catch {
    if (!execution_failed) {
      execution_failed = true;
      execution_error = new SchemaUpgradeError("database_close_failed");
    }
  }
  if (execution_failed) throw execution_error;
  if (report === undefined) {
    throw new SchemaUpgradeError("state_repository_failed");
  }
  return Object.freeze({ storage: "deno-kv", report });
}

export interface DatabaseSchemaUpgradeOutput {
  log(line: string): void;
  error(line: string): void;
}

export class ConsoleDatabaseSchemaUpgradeOutput
  implements DatabaseSchemaUpgradeOutput {
  log(line: string): void {
    console.log(line);
  }

  error(line: string): void {
    console.error(line);
  }
}

function safe_error_line(error: unknown): string {
  if (!(error instanceof SchemaUpgradeError)) {
    return "schema-upgrade failed code=unexpected";
  }
  const fields = [`schema-upgrade failed code=${error.code}`];
  if (error.schema_id !== undefined) fields.push(`schema=${error.schema_id}`);
  if (error.step_id !== undefined) fields.push(`step=${error.step_id}`);
  if (error.from_version !== undefined) {
    fields.push(`from=${error.from_version}`);
  }
  if (error.to_version !== undefined) fields.push(`to=${error.to_version}`);
  return fields.join(" ");
}

function write_report(
  output: DatabaseSchemaUpgradeOutput,
  report: DatabaseSchemaUpgradeReport,
): void {
  for (const schema of report.schemas) {
    output.log(
      `schema-upgrade schema=${schema.schema_id} initial=${schema.initial_version} target=${schema.target_version} outcome=${schema.outcome} steps=${schema.transitions.length}`,
    );
    for (const transition of schema.transitions) {
      output.log(
        `schema-upgrade schema=${schema.schema_id} step=${transition.step_id} from=${transition.from_version} to=${transition.to_version} execution=${transition.execution}`,
      );
    }
  }

  const counts = { upgraded: 0, resumed: 0, no_change: 0 };
  for (const schema of report.schemas) counts[schema.outcome] += 1;
  output.log(
    `schema-upgrade complete schemas=${report.schemas.length} upgraded=${counts.upgraded} resumed=${counts.resumed} no_change=${counts.no_change}`,
  );
}

export async function run_database_schema_upgrade_cli(
  environment: DatabaseSchemaUpgradeEnvironmentSource,
  output: DatabaseSchemaUpgradeOutput =
    new ConsoleDatabaseSchemaUpgradeOutput(),
  options: ExecuteDatabaseSchemaUpgradeOptions = {},
): Promise<number> {
  try {
    const execution = await execute_database_schema_upgrade(
      environment,
      options,
    );
    if (execution.storage === "memory") {
      output.log(
        "schema-upgrade complete schemas=0 upgraded=0 resumed=0 no_change=0 storage=memory",
      );
    } else {
      write_report(output, execution.report);
    }
    return 0;
  } catch (error) {
    output.error(safe_error_line(error));
    return 1;
  }
}
