import {
  ownership_database_schema_version,
  page_database_schema_version,
  session_database_schema_version,
} from "../storage/schema-versions.ts";
import type { SchemaUpgradePlan } from "./interfaces.ts";
import { define_schema_upgrade_plans } from "./plan.ts";

export const database_schema_project_id = "iam-pager";

export interface DenoKvSchemaUpgradeContext {
  readonly kv: Deno.Kv;
}

/**
 * Raw records are already format 1; absent database-manifest metadata is the
 * external version-0 bootstrap handled by `GuardedDatabaseSchemaWriter`.
 */
export const current_database_schema_upgrade_plans: readonly SchemaUpgradePlan<
  DenoKvSchemaUpgradeContext
>[] = define_schema_upgrade_plans([
  {
    schema_id: "ownership",
    baseline_version: 1,
    target_version: ownership_database_schema_version,
    steps: [],
  },
  {
    schema_id: "sessions",
    baseline_version: 1,
    target_version: session_database_schema_version,
    steps: [],
  },
  {
    schema_id: "pages",
    baseline_version: 1,
    target_version: page_database_schema_version,
    steps: [],
  },
]);
