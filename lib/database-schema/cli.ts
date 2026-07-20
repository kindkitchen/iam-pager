import type { KvGateway } from "../storage/kv-gateway.ts";
import { KvToolboxGateway } from "../storage/kv-toolbox-gateway.ts";
import { current_database_schema } from "./current-schema.ts";
import { DenoKvDatabaseSchemaManifestStore } from "./deno-kv-store.ts";
import {
  type DatabaseSchemaDefinition,
  type DatabaseSchemaEntryReport,
  DatabaseSchemaError,
  type DatabaseSchemaReport,
  type DatabaseSchemaUpdateReport,
  define_database_schema,
  ManualDatabaseSchemaManager,
} from "./schema.ts";

export const deno_kv_access_token_env = "DENO_KV_ACCESS_TOKEN";

export interface DatabaseSchemaEnvironment {
  get(name: string): string | undefined;
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

export interface OpenDatabaseSchemaDatabase {
  readonly gateway: KvGateway;
  close(): void | Promise<void>;
}

export interface DatabaseSchemaDatabaseFactory {
  open(target: string): Promise<OpenDatabaseSchemaDatabase>;
}

export class DenoKvDatabaseSchemaDatabaseFactory
  implements DatabaseSchemaDatabaseFactory {
  async open(target: string): Promise<OpenDatabaseSchemaDatabase> {
    const gateway = new KvToolboxGateway(await Deno.openKv(target));
    return { gateway, close: () => gateway.close() };
  }
}

type DatabaseSchemaAction = "check" | "update";
type DatabaseTargetKind = "local" | "remote";

interface DatabaseSchemaCommand {
  readonly action: DatabaseSchemaAction;
  readonly database: string;
  readonly target_kind: DatabaseTargetKind;
  readonly confirmation?: string;
}

class DatabaseSchemaUsageError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "DatabaseSchemaUsageError";
    this.reason = reason;
  }
}

const connector_path_pattern =
  /^\/v2\/databases\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/connect$/i;

function parse_database_target(value: string): {
  readonly database: string;
  readonly target_kind: DatabaseTargetKind;
} {
  if (
    value.length === 0 || value.length > 4096 || value.trim() !== value ||
    value.includes("\0") || value.includes("\n") || value.includes("\r")
  ) {
    throw new DatabaseSchemaUsageError(
      "--database must be one non-empty local KV path or connector URL",
    );
  }
  if (!value.includes("://")) {
    return { database: value, target_kind: "local" };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DatabaseSchemaUsageError(
      "--database is not a valid Deno KV connector URL",
    );
  }
  if (
    url.protocol !== "https:" || url.hostname !== "api.deno.com" ||
    url.port !== "" || url.username !== "" || url.password !== "" ||
    url.search !== "" || url.hash !== "" ||
    !connector_path_pattern.test(url.pathname)
  ) {
    throw new DatabaseSchemaUsageError(
      "remote --database must be an https://api.deno.com/v2/databases/<id>/connect URL without credentials or query values",
    );
  }
  return { database: url.href, target_kind: "remote" };
}

function parse_command(args: readonly string[]): DatabaseSchemaCommand {
  const [action, ...options] = args;
  if (action !== "check" && action !== "update") {
    throw new DatabaseSchemaUsageError(
      "the internal action must be check or update; use a documented deno task",
    );
  }

  const values = new Map<string, string>();
  for (const option of options) {
    const match = /^--(database|confirm)=(.*)$/.exec(option);
    if (match === null) {
      throw new DatabaseSchemaUsageError(`unknown option: ${option}`);
    }
    if (values.has(match[1])) {
      throw new DatabaseSchemaUsageError(
        `--${match[1]} may be provided only once`,
      );
    }
    values.set(match[1], match[2]);
  }
  const database = values.get("database");
  if (database === undefined) {
    throw new DatabaseSchemaUsageError(
      "missing required --database=<local-kv-path|connector-url>",
    );
  }
  if (action === "check" && values.has("confirm")) {
    throw new DatabaseSchemaUsageError(
      "--confirm is accepted only by the update task",
    );
  }
  const target = parse_database_target(database);
  return {
    action,
    ...target,
    ...(values.has("confirm") ? { confirmation: values.get("confirm")! } : {}),
  };
}

function write_usage(output: DatabaseSchemaOutput, reason: string): void {
  output.error("Database schema task did not run.");
  output.error(`Reason: ${reason}`);
  output.error("Required input:");
  output.error("  --database=<local-kv-path|Deno-KV-connector-url>");
  output.error("Examples:");
  output.error("  deno task db:check --database=./data/iam-pager.kv");
  output.error(
    "  DENO_KV_ACCESS_TOKEN=... deno task db:check --database=https://api.deno.com/v2/databases/<database-id>/connect",
  );
}

function version_label(version: number | null): string {
  return version === null ? "none" : String(version);
}

function entry_line(entry: DatabaseSchemaEntryReport): string {
  const expected = version_label(entry.target_version);
  const current = version_label(entry.current_version);
  switch (entry.status) {
    case "current":
      return `  - ${entry.schema_id}: current at ${current}`;
    case "unversioned":
      return `  - ${entry.schema_id}: manifest version is missing; code expects ${expected}`;
    case "stale":
      return `  - ${entry.schema_id}: stale at ${current}; code expects ${expected}`;
    case "future":
      return `  - ${entry.schema_id}: database is newer (${current}) than code (${expected})`;
    case "unsupported":
      return `  - ${entry.schema_id}: ${current} is older than the retained migration path to ${expected}`;
    case "missing":
      return `  - ${entry.schema_id}: missing from manifest; code expects ${expected}`;
    case "unknown":
      return `  - ${entry.schema_id}: manifest declares unknown schema version ${current}`;
  }
}

function write_schema_report(
  output: DatabaseSchemaOutput,
  report: DatabaseSchemaReport,
): void {
  output.log(
    `Database schema: ${
      report.health === "current" ? "healthy" : "needs attention"
    }`,
  );
  output.log(`Expected project: ${report.expected_project_id}`);
  output.log(
    `Manifest project: ${report.manifest_project_id ?? "not initialized"}`,
  );
  for (const schema of report.schemas) output.log(entry_line(schema));

  switch (report.health) {
    case "current":
      output.log("No database schema action is required.");
      break;
    case "unversioned":
      output.log(
        "No manifest exists, so the database cannot prove its project or schema versions.",
      );
      output.log(
        `If this is the intended ${report.expected_project_id} database, initialize it explicitly:`,
      );
      output.log(
        `  deno task db:update --database=<same-target> --confirm=${report.expected_project_id}`,
      );
      break;
    case "stale":
      output.log(
        "All required forward migrations are present in this checkout.",
      );
      output.log("Run:");
      output.log(
        `  deno task db:update --database=<same-target> --confirm=${report.expected_project_id}`,
      );
      break;
    case "wrong_project":
      output.log(
        "Do not update this target. Verify --database; its manifest belongs to another project.",
      );
      break;
    case "incompatible":
      output.log(
        "No safe automatic update is available. Use the matching code version or add/repair an explicit migration after backup.",
      );
      break;
  }
}

function write_update_report(
  output: DatabaseSchemaOutput,
  report: DatabaseSchemaUpdateReport,
): void {
  if (report.outcome === "no_change") {
    output.log(
      "Database schema update: no change; the database is already current.",
    );
    return;
  }
  output.log("Database schema update: complete.");
  if (report.initialized_manifest) {
    output.log("  - initialized the project/schema manifest");
  }
  if (report.migrations.length === 0) {
    output.log("  - no data migration was required");
  } else {
    for (const migration of report.migrations) {
      output.log(
        `  - ${migration.schema_id} ${migration.from_version}->${migration.to_version}: ${migration.description}`,
      );
    }
  }
}

function write_schema_failure(
  output: DatabaseSchemaOutput,
  error: unknown,
): void {
  if (!(error instanceof DatabaseSchemaError)) {
    output.error("Database schema task failed unexpectedly.");
    output.error(
      "No success was recorded. Check database availability and rerun db:check.",
    );
    return;
  }

  switch (error.code) {
    case "invalid_definition":
      output.error("The schema registry in this checkout is invalid.");
      output.error(
        "Fix duplicate/gapped versions or missing adjacent migrations before touching a database.",
      );
      break;
    case "invalid_manifest":
      output.error("The database schema manifest is malformed or unsupported.");
      output.error(
        "No update was attempted. Back up the database and inspect the manifest record before repair.",
      );
      break;
    case "manifest_store_failed":
      output.error(
        "The database schema manifest could not be read or written.",
      );
      output.error(
        "Check the target, token, network, and Deno KV permissions; then rerun db:check.",
      );
      break;
    case "update_unavailable":
      output.error(
        "This checkout has no safe update path for the database state.",
      );
      output.error(
        "No manifest was published. Run db:check and resolve every reported incompatible entry.",
      );
      break;
    case "migration_failed":
      output.error(
        `Database migration failed: ${error.schema_id ?? "unknown"} ${
          error.from_version ?? "?"
        }->${error.to_version ?? "?"} (${error.migration_id ?? "unknown"}).`,
      );
      output.error(
        "The manifest was not advanced. Fix the cause and rerun; every migration must be repeat-safe.",
      );
      break;
    case "manifest_conflict":
      output.error("The schema manifest changed while the update was running.");
      output.error(
        "Do not guess the result. Run db:check again before any retry.",
      );
      break;
  }
}

export interface RunDatabaseSchemaCliOptions {
  readonly database_factory?: DatabaseSchemaDatabaseFactory;
  readonly definition?: DatabaseSchemaDefinition<KvGateway>;
}

export async function run_database_schema_cli(
  args: readonly string[],
  environment: DatabaseSchemaEnvironment,
  output: DatabaseSchemaOutput = new ConsoleDatabaseSchemaOutput(),
  options: RunDatabaseSchemaCliOptions = {},
): Promise<number> {
  let command: DatabaseSchemaCommand;
  try {
    command = parse_command(args);
  } catch (error) {
    write_usage(
      output,
      error instanceof DatabaseSchemaUsageError
        ? error.reason
        : "invalid command input",
    );
    return 2;
  }

  let definition: DatabaseSchemaDefinition<KvGateway>;
  try {
    definition = define_database_schema(
      options.definition ?? current_database_schema,
    );
  } catch (error) {
    write_schema_failure(output, error);
    return 1;
  }

  if (command.target_kind === "remote") {
    const token = environment.get(deno_kv_access_token_env);
    if (
      token === undefined || token.length === 0 || token.trim() !== token
    ) {
      output.error("Remote database authentication is missing.");
      output.error(
        `Set ${deno_kv_access_token_env} to a non-empty access token in the command environment.`,
      );
      output.error("The token must not be passed as a command argument.");
      return 2;
    }
  }

  const database_factory = options.database_factory ??
    new DenoKvDatabaseSchemaDatabaseFactory();
  let database: OpenDatabaseSchemaDatabase;
  try {
    database = await database_factory.open(command.database);
  } catch {
    output.error("The database could not be opened.");
    output.error(
      command.target_kind === "remote"
        ? "Check the connector URL, access token, network, and token permissions."
        : "Check the local path and read/write permissions.",
    );
    return 1;
  }

  let exit_code = 1;
  try {
    const manager = new ManualDatabaseSchemaManager({
      definition,
      manifest_store: new DenoKvDatabaseSchemaManifestStore(database.gateway),
    });
    const initial_report = await manager.inspect();

    if (command.action === "check") {
      write_schema_report(output, initial_report);
      exit_code = initial_report.health === "current" ? 0 : 1;
    } else if (initial_report.health === "current") {
      write_schema_report(output, initial_report);
      exit_code = 0;
    } else if (!initial_report.update_available) {
      write_schema_report(output, initial_report);
      output.error("Database schema update was not attempted.");
      exit_code = 1;
    } else if (command.confirmation !== initial_report.expected_project_id) {
      write_schema_report(output, initial_report);
      output.error("Database schema update was not applied.");
      output.error(
        `Missing confirmation: --confirm=${initial_report.expected_project_id}`,
      );
      output.error(
        "This confirmation asserts that --database names the intended project, especially when no manifest exists.",
      );
      exit_code = 2;
    } else {
      const update_report = await manager.update(database.gateway);
      write_update_report(output, update_report);
      const final_report = await manager.inspect();
      write_schema_report(output, final_report);
      exit_code = final_report.health === "current" ? 0 : 1;
    }
  } catch (error) {
    write_schema_failure(output, error);
    exit_code = 1;
  }

  try {
    await database.close();
  } catch {
    output.error("The database was processed but could not be closed cleanly.");
    output.error("Run db:check again before relying on the result.");
    exit_code = 1;
  }
  return exit_code;
}
