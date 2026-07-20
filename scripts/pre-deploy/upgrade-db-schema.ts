import {
  ConsoleDatabaseSchemaUpgradeOutput,
  run_database_schema_upgrade_cli,
} from "@/lib/schema-upgrade/mod.ts";

if (import.meta.main) {
  Deno.exitCode = await run_database_schema_upgrade_cli(
    Deno.env,
    new ConsoleDatabaseSchemaUpgradeOutput(),
  );
}
