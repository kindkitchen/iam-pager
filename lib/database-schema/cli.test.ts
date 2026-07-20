import { assertEquals, assertStringIncludes } from "@std/assert";
import { KvToolboxGateway } from "../storage/kv-toolbox-gateway.ts";
import {
  type DatabaseSchemaDatabaseFactory,
  type DatabaseSchemaOutput,
  deno_kv_access_token_env,
  run_database_schema_cli,
} from "./cli.ts";
import { database_schema_manifest_key } from "./deno-kv-store.ts";

class CapturedOutput implements DatabaseSchemaOutput {
  readonly logs: string[] = [];
  readonly errors: string[] = [];

  log(line: string): void {
    this.logs.push(line);
  }

  error(line: string): void {
    this.errors.push(line);
  }
}

class ExistingDatabaseFactory implements DatabaseSchemaDatabaseFactory {
  readonly gateway: KvToolboxGateway;
  opened = 0;

  constructor(kv: Deno.Kv) {
    this.gateway = new KvToolboxGateway(kv);
  }

  open(
    _target: string,
  ): Promise<{ gateway: KvToolboxGateway; close(): void }> {
    this.opened += 1;
    return Promise.resolve({ gateway: this.gateway, close: () => {} });
  }
}

const environment = (
  values: Readonly<Record<string, string>> = {},
) => ({ get: (name: string) => values[name] });

Deno.test("manual database tasks explain missing target and remote token", async () => {
  const missing_target = new CapturedOutput();
  assertEquals(
    await run_database_schema_cli(
      ["check"],
      environment(),
      missing_target,
    ),
    2,
  );
  assertStringIncludes(missing_target.errors.join("\n"), "missing required");
  assertStringIncludes(missing_target.errors.join("\n"), "Examples:");

  const remote = new CapturedOutput();
  const kv = await Deno.openKv(":memory:");
  try {
    const factory = new ExistingDatabaseFactory(kv);
    assertEquals(
      await run_database_schema_cli(
        [
          "check",
          "--database=https://api.deno.com/v2/databases/00000000-0000-0000-0000-000000000000/connect",
        ],
        environment(),
        remote,
        { database_factory: factory },
      ),
      2,
    );
    assertEquals(factory.opened, 0);
    assertStringIncludes(
      remote.errors.join("\n"),
      deno_kv_access_token_env,
    );
    assertStringIncludes(remote.errors.join("\n"), "must not be passed");
  } finally {
    kv.close();
  }
});

Deno.test("manual database tasks diagnose an invalid migration registry before opening a target", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const output = new CapturedOutput();
    const factory = new ExistingDatabaseFactory(kv);
    assertEquals(
      await run_database_schema_cli(
        ["check", "--database=:memory:"],
        environment(),
        output,
        {
          database_factory: factory,
          definition: {
            project_id: "iam-pager",
            schemas: [{
              schema_id: "pages",
              baseline_version: 1,
              target_version: 2,
            }],
            migrations: [],
          },
        },
      ),
      1,
    );
    assertEquals(factory.opened, 0);
    assertStringIncludes(output.errors.join("\n"), "registry");
    assertStringIncludes(output.errors.join("\n"), "missing adjacent");
  } finally {
    kv.close();
  }
});

Deno.test("manual database check reports unversioned state and exact next action", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const output = new CapturedOutput();
    assertEquals(
      await run_database_schema_cli(
        ["check", "--database=:memory:"],
        environment(),
        output,
        { database_factory: new ExistingDatabaseFactory(kv) },
      ),
      1,
    );
    const report = output.logs.join("\n");
    assertStringIncludes(report, "needs attention");
    assertStringIncludes(report, "Manifest project: not initialized");
    assertStringIncludes(report, "deno task db:update");
    assertStringIncludes(report, "--confirm=iam-pager");
    assertEquals((await kv.get(database_schema_manifest_key())).value, null);
  } finally {
    kv.close();
  }
});

Deno.test("manual database update inspects before requiring explicit project confirmation", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const output = new CapturedOutput();
    assertEquals(
      await run_database_schema_cli(
        ["update", "--database=:memory:"],
        environment(),
        output,
        { database_factory: new ExistingDatabaseFactory(kv) },
      ),
      2,
    );
    assertStringIncludes(output.errors.join("\n"), "Missing confirmation");
    assertStringIncludes(output.errors.join("\n"), "asserts");
    assertEquals((await kv.get(database_schema_manifest_key())).value, null);
  } finally {
    kv.close();
  }
});

Deno.test("confirmed manual database update initializes and verifies the manifest", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const output = new CapturedOutput();
    assertEquals(
      await run_database_schema_cli(
        [
          "update",
          "--database=:memory:",
          "--confirm=iam-pager",
        ],
        environment(),
        output,
        { database_factory: new ExistingDatabaseFactory(kv) },
      ),
      0,
    );
    const report = output.logs.join("\n");
    assertStringIncludes(report, "update: complete");
    assertStringIncludes(report, "no data migration was required");
    assertStringIncludes(report, "Database schema: healthy");

    const stored = (await kv.get<Record<string, unknown>>(
      database_schema_manifest_key(),
    )).value;
    assertEquals(stored?.project_id, "iam-pager");
    assertEquals(stored?.schema_versions, [
      { schema_id: "ownership", version: 1 },
      { schema_id: "pages", version: 1 },
      { schema_id: "sessions", version: 1 },
    ]);
  } finally {
    kv.close();
  }
});

Deno.test("manual database update refuses a manifest owned by another project", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await kv.set(database_schema_manifest_key(), {
      schema_version: 1,
      project_id: "other-project",
      schema_versions: [{ schema_id: "pages", version: 1 }],
    });
    const output = new CapturedOutput();
    assertEquals(
      await run_database_schema_cli(
        [
          "update",
          "--database=:memory:",
          "--confirm=iam-pager",
        ],
        environment({ [deno_kv_access_token_env]: "unused-local-token" }),
        output,
        { database_factory: new ExistingDatabaseFactory(kv) },
      ),
      1,
    );
    assertStringIncludes(output.logs.join("\n"), "another project");
    assertStringIncludes(output.errors.join("\n"), "not attempted");
    assertEquals(
      (await kv.get<Record<string, unknown>>(database_schema_manifest_key()))
        .value?.project_id,
      "other-project",
    );
  } finally {
    kv.close();
  }
});
