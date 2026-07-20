import { assertEquals } from "@std/assert";
import {
  OWNERSHIP_DENO_KV_PATH_ENV,
  OWNERSHIP_STORAGE_BACKEND_ENV,
  PAGE_STORAGE_BACKEND_ENV,
  SESSION_STORAGE_BACKEND_ENV,
} from "../storage/mod.ts";
import { database_schema_project_id } from "./current-plans.ts";
import { DenoKvDatabaseSchemaManifestRepository } from "./deno-kv-manifest-repository.ts";
import { DenoKvSchemaUpgradeStateRepository } from "./deno-kv-state-repository.ts";
import type {
  DatabaseSchemaConnection,
  DatabaseSchemaConnectionFactory,
  DatabaseSchemaEnvironmentSource,
  DatabaseSchemaOutput,
} from "./pre-deploy.ts";
import {
  parse_database_schema_storage_config,
  run_database_schema_check_cli,
} from "./pre-deploy.ts";

function environment(
  values: Readonly<Record<string, string>>,
): DatabaseSchemaEnvironmentSource {
  return { get: (name) => values[name] };
}

class SharedKvConnectionFactory implements DatabaseSchemaConnectionFactory {
  readonly kv: Deno.Kv;
  opened_paths: (string | undefined)[] = [];
  close_count = 0;

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  open(path?: string): Promise<DatabaseSchemaConnection> {
    this.opened_paths.push(path);
    return Promise.resolve({
      context: { kv: this.kv },
      manifest_repository: new DenoKvDatabaseSchemaManifestRepository(this.kv),
      state_repository: new DenoKvSchemaUpgradeStateRepository(this.kv),
      close: () => {
        this.close_count += 1;
      },
    });
  }
}

class RecordingOutput implements DatabaseSchemaOutput {
  readonly logs: string[] = [];
  readonly errors: string[] = [];

  log(line: string): void {
    this.logs.push(line);
  }

  error(line: string): void {
    this.errors.push(line);
  }
}

function durable_environment(): DatabaseSchemaEnvironmentSource {
  return environment({
    [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
    [OWNERSHIP_DENO_KV_PATH_ENV]: "/data/production.kv",
    [SESSION_STORAGE_BACKEND_ENV]: "deno-kv",
    [PAGE_STORAGE_BACKEND_ENV]: "deno-kv",
  });
}

Deno.test("pre-deploy schema check reuses linked storage validation", () => {
  assertEquals(parse_database_schema_storage_config(environment({})), {
    backend: "memory",
  });
  assertEquals(
    parse_database_schema_storage_config(durable_environment()),
    { backend: "deno-kv", path: "/data/production.kv" },
  );
});

Deno.test("pre-deploy schema check rejects memory or incompatible storage", async () => {
  for (
    const test_environment of [
      environment({}),
      environment({ [SESSION_STORAGE_BACKEND_ENV]: "deno-kv" }),
      environment({ [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv" }),
    ]
  ) {
    const output = new RecordingOutput();
    const status = await run_database_schema_check_cli(
      test_environment,
      output,
      {
        database_factory: {
          open: () => Promise.reject(new Error("must not open")),
        },
      },
    );
    assertEquals(status, 1);
    assertEquals(output.logs, []);
    assertEquals(output.errors, [
      "database-schema failed code=invalid_configuration",
    ]);
  }
});

Deno.test("pre-deploy schema check reads exact current metadata without writes", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const manifest_repository = new DenoKvDatabaseSchemaManifestRepository(kv);
    const state_repository = new DenoKvSchemaUpgradeStateRepository(kv);
    const versions = [
      { schema_id: "ownership", version: 1 },
      { schema_id: "pages", version: 1 },
      { schema_id: "sessions", version: 1 },
    ] as const;
    await manifest_repository.initialize_manifest({
      project_id: database_schema_project_id,
      schema_versions: versions,
    });
    for (const version of versions) {
      await state_repository.initialize_state({
        schema_id: version.schema_id,
        baseline_version: version.version,
      });
    }
    const before = await Promise.all([
      kv.get(["database-schema", "v1", "manifest"]),
      kv.get(["iam-pager", "schema-upgrades", "v1", "states", "pages"]),
    ]);
    const factory = new SharedKvConnectionFactory(kv);
    const output = new RecordingOutput();

    const status = await run_database_schema_check_cli(
      durable_environment(),
      output,
      { database_factory: factory },
    );

    assertEquals(status, 0);
    assertEquals(factory.opened_paths, ["/data/production.kv"]);
    assertEquals(factory.close_count, 1);
    assertEquals(output.errors, []);
    assertEquals(
      output.logs.at(-1),
      "database-schema check project=iam-pager outcome=current",
    );
    const after = await Promise.all([
      kv.get(["database-schema", "v1", "manifest"]),
      kv.get(["iam-pager", "schema-upgrades", "v1", "states", "pages"]),
    ]);
    assertEquals(
      after.map((entry) => entry.versionstamp),
      before.map((entry) => entry.versionstamp),
    );
  } finally {
    kv.close();
  }
});

Deno.test("pre-deploy schema check fails an unversioned DB without initializing it", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const factory = new SharedKvConnectionFactory(kv);
    const output = new RecordingOutput();
    const status = await run_database_schema_check_cli(
      durable_environment(),
      output,
      { database_factory: factory },
    );

    assertEquals(status, 1);
    assertEquals(output.logs, []);
    assertEquals(
      output.errors.at(-1),
      "database-schema check project=iam-pager outcome=unversioned",
    );
    assertEquals(
      await new DenoKvDatabaseSchemaManifestRepository(kv).read_manifest(),
      null,
    );
    assertEquals(
      await new DenoKvSchemaUpgradeStateRepository(kv).read_state("pages"),
      null,
    );
    assertEquals(factory.close_count, 1);
  } finally {
    kv.close();
  }
});
