import {
  ConsoleDatabaseSchemaOutput,
  run_remote_database_schema_write_cli,
} from "@/lib/schema-upgrade/mod.ts";

if (import.meta.main) {
  Deno.exitCode = await run_remote_database_schema_write_cli(
    Deno.args,
    Deno.env,
    new ConsoleDatabaseSchemaOutput(),
  );
}
