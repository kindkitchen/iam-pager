import {
  ownership_database_schema_version,
  page_database_schema_version,
  session_database_schema_version,
} from "../storage/schema-versions.ts";
import type { SchemaUpgradePlan } from "./interfaces.ts";
import { define_schema_upgrade_plans } from "./plan.ts";

export interface DenoKvSchemaUpgradeContext {
  readonly kv: Deno.Kv;
}

/**
 * Raw Deno KV databases created before this framework are baseline version 1.
 * No application-data transformation is needed until one target advances.
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
