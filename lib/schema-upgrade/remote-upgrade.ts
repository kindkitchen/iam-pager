import {
  current_database_schema_upgrade_plans,
  database_schema_project_id,
  type DenoKvSchemaUpgradeContext,
} from "./current-plans.ts";
import { SchemaUpgradeError } from "./errors.ts";
import type {
  DatabaseSchemaWriteReport,
  DatabaseSchemaWriteRequest,
  SchemaUpgradePlan,
} from "./interfaces.ts";
import { define_database_schema_versions } from "./manifest.ts";
import {
  type DatabaseSchemaConnectionFactory,
  type DatabaseSchemaEnvironmentSource,
  type DatabaseSchemaOutput,
  DenoKvDatabaseSchemaConnectionFactory,
  safe_schema_error_line,
} from "./pre-deploy.ts";
import { is_schema_upgrade_identifier } from "./plan.ts";
import { GuardedDatabaseSchemaWriter } from "./writer.ts";

export const DENO_KV_ACCESS_TOKEN_ENV = "DENO_KV_ACCESS_TOKEN";

export interface RemoteDatabaseSchemaWriteCommand {
  readonly database_url: string;
  readonly request: DatabaseSchemaWriteRequest;
}

const connector_path_pattern =
  /^\/v2\/databases\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/connect$/i;

function parse_database_url(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SchemaUpgradeError("invalid_database_url");
  }
  if (
    url.protocol !== "https:" || url.hostname !== "api.deno.com" ||
    url.port !== "" || url.username !== "" || url.password !== "" ||
    url.search !== "" || url.hash !== "" ||
    !connector_path_pattern.test(url.pathname)
  ) {
    throw new SchemaUpgradeError("invalid_database_url");
  }
  return url.href;
}

function parse_version_vector(value: string, allow_zero: boolean) {
  if (value.length === 0 || value.length > 4096 || value.trim() !== value) {
    throw new SchemaUpgradeError("invalid_request");
  }
  const versions = value.split(",").map((part) => {
    const separator = part.indexOf(":");
    if (separator < 1 || separator !== part.lastIndexOf(":")) {
      throw new SchemaUpgradeError("invalid_request");
    }
    const schema_id = part.slice(0, separator);
    const version_text = part.slice(separator + 1);
    if (
      !is_schema_upgrade_identifier(schema_id) ||
      !(allow_zero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/).test(version_text)
    ) {
      throw new SchemaUpgradeError("invalid_request");
    }
    const version = Number(version_text);
    if (!Number.isSafeInteger(version)) {
      throw new SchemaUpgradeError("invalid_request");
    }
    return { schema_id, version };
  });
  return define_database_schema_versions(versions, {
    allow_zero,
    error_code: "invalid_request",
  });
}

export function parse_remote_database_schema_write_command(
  args: readonly string[],
): RemoteDatabaseSchemaWriteCommand {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(database-url|project|from|to)=(.*)$/.exec(arg);
    if (match === null || values.has(match[1])) {
      throw new SchemaUpgradeError("invalid_request");
    }
    values.set(match[1], match[2]);
  }
  if (values.size !== 4) throw new SchemaUpgradeError("invalid_request");

  const project_id = values.get("project")!;
  if (!is_schema_upgrade_identifier(project_id)) {
    throw new SchemaUpgradeError("invalid_request");
  }
  return Object.freeze({
    database_url: parse_database_url(values.get("database-url")!),
    request: Object.freeze({
      project_id,
      from_versions: parse_version_vector(values.get("from")!, true),
      to_versions: parse_version_vector(values.get("to")!, false),
    }),
  });
}

export interface ExecuteRemoteDatabaseSchemaWriteOptions {
  readonly database_factory?: DatabaseSchemaConnectionFactory;
  readonly plans?: readonly SchemaUpgradePlan<DenoKvSchemaUpgradeContext>[];
  readonly project_id?: string;
}

export async function execute_remote_database_schema_write(
  command: RemoteDatabaseSchemaWriteCommand,
  environment: DatabaseSchemaEnvironmentSource,
  options: ExecuteRemoteDatabaseSchemaWriteOptions = {},
): Promise<DatabaseSchemaWriteReport> {
  const project_id = options.project_id ?? database_schema_project_id;
  if (command.request.project_id !== project_id) {
    throw new SchemaUpgradeError("wrong_project", { project_id });
  }
  const access_token = environment.get(DENO_KV_ACCESS_TOKEN_ENV);
  if (
    access_token === undefined || access_token.length === 0 ||
    access_token.trim() !== access_token
  ) {
    throw new SchemaUpgradeError("missing_access_token");
  }

  const database_factory = options.database_factory ??
    new DenoKvDatabaseSchemaConnectionFactory();
  let database;
  try {
    database = await database_factory.open(command.database_url);
  } catch (error) {
    if (error instanceof SchemaUpgradeError) throw error;
    throw new SchemaUpgradeError("database_unavailable");
  }

  let failed = false;
  let failure: unknown;
  let report: DatabaseSchemaWriteReport | undefined;
  try {
    const writer = new GuardedDatabaseSchemaWriter({
      project_id,
      manifest_repository: database.manifest_repository,
      state_repository: database.state_repository,
      plans: options.plans ?? current_database_schema_upgrade_plans,
    });
    report = await writer.write(command.request, database.context);
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

function write_schema_write_report(
  output: DatabaseSchemaOutput,
  report: DatabaseSchemaWriteReport,
): void {
  for (const schema of report.upgrade.schemas) {
    output.log(
      `database-schema write project=${report.project_id} schema=${schema.schema_id} from=${schema.initial_version} to=${schema.target_version} outcome=${schema.outcome}`,
    );
  }
  output.log(
    `database-schema write project=${report.project_id} outcome=complete`,
  );
}

export async function run_remote_database_schema_write_cli(
  args: readonly string[],
  environment: DatabaseSchemaEnvironmentSource,
  output: DatabaseSchemaOutput,
  options: ExecuteRemoteDatabaseSchemaWriteOptions = {},
): Promise<number> {
  try {
    const command = parse_remote_database_schema_write_command(args);
    const report = await execute_remote_database_schema_write(
      command,
      environment,
      options,
    );
    write_schema_write_report(output, report);
    return 0;
  } catch (error) {
    output.error(safe_schema_error_line(error));
    return 1;
  }
}
