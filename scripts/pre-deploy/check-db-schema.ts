import {
  ConsoleDatabaseSchemaOutput,
  run_database_schema_check_cli,
} from "@/lib/schema-upgrade/mod.ts";

if (import.meta.main) {
  Deno.exitCode = await run_database_schema_check_cli(
    Deno.env,
    new ConsoleDatabaseSchemaOutput(),
  );
}
