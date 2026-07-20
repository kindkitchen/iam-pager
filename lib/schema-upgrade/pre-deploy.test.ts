import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  OWNERSHIP_DENO_KV_PATH_ENV,
  OWNERSHIP_STORAGE_BACKEND_ENV,
  PAGE_STORAGE_BACKEND_ENV,
  SESSION_STORAGE_BACKEND_ENV,
} from "../storage/mod.ts";
import { DenoKvSchemaUpgradeStateRepository } from "./deno-kv-state-repository.ts";
import type {
  DatabaseSchemaUpgradeConnection,
  DatabaseSchemaUpgradeConnectionFactory,
  DatabaseSchemaUpgradeEnvironmentSource,
  DatabaseSchemaUpgradeOutput,
} from "./pre-deploy.ts";
import {
  execute_database_schema_upgrade,
  parse_database_schema_upgrade_storage_config,
  run_database_schema_upgrade_cli,
} from "./pre-deploy.ts";

function environment(
  values: Readonly<Record<string, string>>,
): DatabaseSchemaUpgradeEnvironmentSource {
  return { get: (name) => values[name] };
}

class SharedKvConnectionFactory
  implements DatabaseSchemaUpgradeConnectionFactory {
  readonly kv: Deno.Kv;
  opened_paths: (string | undefined)[] = [];
  close_count = 0;

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  open(path?: string): Promise<DatabaseSchemaUpgradeConnection> {
    this.opened_paths.push(path);
    return Promise.resolve({
      context: { kv: this.kv },
      state_repository: new DenoKvSchemaUpgradeStateRepository(this.kv),
      close: () => {
        this.close_count += 1;
      },
    });
  }
}

class RecordingOutput implements DatabaseSchemaUpgradeOutput {
  readonly logs: string[] = [];
  readonly errors: string[] = [];

  log(line: string): void {
    this.logs.push(line);
  }

  error(line: string): void {
    this.errors.push(line);
  }
}

Deno.test("pre-deploy schema configuration reuses linked storage validation", () => {
  assertEquals(parse_database_schema_upgrade_storage_config(environment({})), {
    backend: "memory",
  });
  assertEquals(
    parse_database_schema_upgrade_storage_config(environment({
      [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
    })),
    { backend: "deno-kv" },
  );
  assertEquals(
    parse_database_schema_upgrade_storage_config(environment({
      [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
      [OWNERSHIP_DENO_KV_PATH_ENV]: "/data/production.kv",
      [SESSION_STORAGE_BACKEND_ENV]: "deno-kv",
      [PAGE_STORAGE_BACKEND_ENV]: "deno-kv",
    })),
    { backend: "deno-kv", path: "/data/production.kv" },
  );
});

Deno.test("pre-deploy schema configuration rejects incompatible linked storage", async () => {
  const output = new RecordingOutput();
  const status = await run_database_schema_upgrade_cli(
    environment({ [SESSION_STORAGE_BACKEND_ENV]: "deno-kv" }),
    output,
  );

  assertEquals(status, 1);
  assertEquals(output.logs, []);
  assertEquals(output.errors, [
    "schema-upgrade failed code=invalid_configuration",
  ]);
});

Deno.test("pre-deploy selects the configured KV, baselines existing data, and repeats safely", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const raw_page_key: Deno.KvKey = ["iam-pager", "pages", "by-id", "old"];
    const raw_page = { schema_version: 1, page_id: "old" };
    await kv.set(raw_page_key, raw_page);
    const factory = new SharedKvConnectionFactory(kv);
    const durable_environment = environment({
      [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
      [OWNERSHIP_DENO_KV_PATH_ENV]: "/data/production.kv",
      [SESSION_STORAGE_BACKEND_ENV]: "deno-kv",
      [PAGE_STORAGE_BACKEND_ENV]: "deno-kv",
    });

    const first = await execute_database_schema_upgrade(durable_environment, {
      database_factory: factory,
    });
    const second = await execute_database_schema_upgrade(durable_environment, {
      database_factory: factory,
    });

    assertEquals(factory.opened_paths, [
      "/data/production.kv",
      "/data/production.kv",
    ]);
    assertEquals(factory.close_count, 2);
    assertEquals(first.storage, "deno-kv");
    assertEquals(second.storage, "deno-kv");
    if (first.storage !== "deno-kv" || second.storage !== "deno-kv") return;
    assertEquals(
      first.report.schemas.map((schema) => [schema.schema_id, schema.outcome]),
      [
        ["ownership", "no_change"],
        ["sessions", "no_change"],
        ["pages", "no_change"],
      ],
    );
    assertEquals(
      second.report.schemas.map((schema) => schema.outcome),
      ["no_change", "no_change", "no_change"],
    );
    const state_repository = new DenoKvSchemaUpgradeStateRepository(kv);
    for (const schema_id of ["ownership", "sessions", "pages"]) {
      assertEquals(await state_repository.read_state(schema_id), {
        current_version: 1,
        pending_transition: null,
      });
    }
    assertEquals((await kv.get(raw_page_key)).value, raw_page);
  } finally {
    kv.close();
  }
});

Deno.test("pre-deploy CLI succeeds without opening a database for memory storage", async () => {
  const output = new RecordingOutput();
  const status = await run_database_schema_upgrade_cli(
    environment({}),
    output,
    {
      database_factory: {
        open: () => Promise.reject(new Error("must not open")),
      },
    },
  );

  assertEquals(status, 0);
  assertEquals(output.errors, []);
  assertEquals(output.logs, [
    "schema-upgrade complete schemas=0 upgraded=0 resumed=0 no_change=0 storage=memory",
  ]);
});

Deno.test("pre-deploy CLI reports bounded step failure and preserves its claim", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const output = new RecordingOutput();
    const factory = new SharedKvConnectionFactory(kv);
    const status = await run_database_schema_upgrade_cli(
      environment({
        [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
        [OWNERSHIP_DENO_KV_PATH_ENV]: "/secret/database-path.kv",
      }),
      output,
      {
        database_factory: factory,
        plans: [{
          schema_id: "pages",
          baseline_version: 1,
          target_version: 2,
          steps: [{
            step_id: "pages-v1-to-v2",
            from_version: 1,
            to_version: 2,
            upgrade: () => {
              throw new Error("stored secret value");
            },
          }],
        }],
      },
    );

    assertEquals(status, 1);
    assertEquals(output.logs, []);
    assertEquals(output.errors, [
      "schema-upgrade failed code=step_failed schema=pages step=pages-v1-to-v2 from=1 to=2",
    ]);
    assertEquals(output.errors[0].includes("secret"), false);
    assertEquals(output.errors[0].includes("database-path"), false);
    assertEquals(factory.close_count, 1);
    assertEquals(
      (await new DenoKvSchemaUpgradeStateRepository(kv).read_state("pages"))
        ?.pending_transition,
      {
        step_id: "pages-v1-to-v2",
        from_version: 1,
        to_version: 2,
      },
    );
  } finally {
    kv.close();
  }
});

Deno.test("pre-deploy CLI hides database opener details on failure", async () => {
  const output = new RecordingOutput();
  const status = await run_database_schema_upgrade_cli(
    environment({
      [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
      [OWNERSHIP_DENO_KV_PATH_ENV]: "/secret/database-path.kv",
    }),
    output,
    {
      database_factory: {
        open: () =>
          Promise.reject(new Error("failed /secret/database-path.kv")),
      },
    },
  );

  assertEquals(status, 1);
  assertEquals(output.logs, []);
  assertEquals(output.errors, [
    "schema-upgrade failed code=database_unavailable",
  ]);
  assertStringIncludes(output.errors[0], "database_unavailable");
  assertEquals(output.errors[0].includes("secret"), false);
});
