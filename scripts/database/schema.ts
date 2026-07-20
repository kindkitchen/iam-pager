import {
  ConsoleDatabaseSchemaOutput,
  run_database_schema_cli,
} from "@/lib/database-schema/mod.ts";

if (import.meta.main) {
  Deno.exitCode = await run_database_schema_cli(
    Deno.args,
    Deno.env,
    new ConsoleDatabaseSchemaOutput(),
  );
}
