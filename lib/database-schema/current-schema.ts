import {
  ownership_database_schema_version,
  page_database_schema_version,
  session_database_schema_version,
} from "../storage/schema-versions.ts";
import type { KvGateway } from "../storage/kv-gateway.ts";
import type { DatabaseSchemaDefinition } from "./schema.ts";

export const database_schema_project_id = "iam-pager";

/**
 * This is the manual database task registry. Add one repeat-safe migration for
 * every adjacent version bump; deploy and application startup never run it.
 */
export const current_database_schema: DatabaseSchemaDefinition<KvGateway> = {
  project_id: database_schema_project_id,
  schemas: [
    {
      schema_id: "ownership",
      baseline_version: 1,
      target_version: ownership_database_schema_version,
    },
    {
      schema_id: "sessions",
      baseline_version: 1,
      target_version: session_database_schema_version,
    },
    {
      schema_id: "pages",
      baseline_version: 1,
      target_version: page_database_schema_version,
    },
  ],
  migrations: [],
};
