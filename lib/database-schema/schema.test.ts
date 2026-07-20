import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  database_schema_manifests_equal,
  DatabaseSchemaError,
  type DatabaseSchemaManifest,
  type DatabaseSchemaManifestStore,
  define_database_schema,
  inspect_database_schema,
  ManualDatabaseSchemaManager,
} from "./schema.ts";

class MemoryManifestStore implements DatabaseSchemaManifestStore {
  manifest: DatabaseSchemaManifest | null;
  conflict = false;
  writes = 0;

  constructor(manifest: DatabaseSchemaManifest | null) {
    this.manifest = manifest;
  }

  read_manifest(): Promise<DatabaseSchemaManifest | null> {
    return Promise.resolve(this.manifest);
  }

  write_manifest(input: {
    readonly expected_manifest: DatabaseSchemaManifest | null;
    readonly manifest: DatabaseSchemaManifest;
  }): Promise<"written" | "conflict"> {
    if (
      this.conflict ||
      !database_schema_manifests_equal(this.manifest, input.expected_manifest)
    ) {
      return Promise.resolve("conflict");
    }
    this.manifest = input.manifest;
    this.writes += 1;
    return Promise.resolve("written");
  }
}

function manifest(
  schema_versions: readonly {
    readonly schema_id: string;
    readonly version: number;
  }[],
  project_id = "iam-pager",
): DatabaseSchemaManifest {
  return { project_id, schema_versions };
}

Deno.test("database schema definition requires a complete adjacent migration path", () => {
  assertThrows(
    () =>
      define_database_schema({
        project_id: "iam-pager",
        schemas: [{
          schema_id: "pages",
          baseline_version: 1,
          target_version: 2,
        }],
        migrations: [],
      }),
    DatabaseSchemaError,
  );

  const definition = define_database_schema({
    project_id: "iam-pager",
    schemas: [{
      schema_id: "pages",
      baseline_version: 1,
      target_version: 2,
    }],
    migrations: [{
      migration_id: "pages-v1-to-v2",
      schema_id: "pages",
      from_version: 1,
      to_version: 2,
      description: "add the v2 page index",
      migrate: () => {},
    }],
  });
  assertEquals(definition.schemas[0].target_version, 2);
});

Deno.test("database schema inspection explains current, stale, and unversioned states", () => {
  const definition = define_database_schema({
    project_id: "iam-pager",
    schemas: [
      { schema_id: "ownership", baseline_version: 1, target_version: 1 },
      { schema_id: "pages", baseline_version: 1, target_version: 2 },
    ],
    migrations: [{
      migration_id: "pages-v1-to-v2",
      schema_id: "pages",
      from_version: 1,
      to_version: 2,
      description: "add the v2 page index",
      migrate: () => {},
    }],
  });

  const unversioned = inspect_database_schema(null, definition);
  assertEquals(unversioned.health, "unversioned");
  assertEquals(unversioned.update_available, true);
  assertEquals(
    unversioned.schemas.map((schema) => schema.status),
    ["unversioned", "unversioned"],
  );

  const stale = inspect_database_schema(
    manifest([
      { schema_id: "pages", version: 1 },
      { schema_id: "ownership", version: 1 },
    ]),
    definition,
  );
  assertEquals(stale.health, "stale");
  assertEquals(stale.update_available, true);
  assertEquals(
    stale.schemas.map((schema) => [schema.schema_id, schema.status]),
    [["ownership", "current"], ["pages", "stale"]],
  );

  const current = inspect_database_schema(
    manifest([
      { schema_id: "ownership", version: 1 },
      { schema_id: "pages", version: 2 },
    ]),
    definition,
  );
  assertEquals(current.health, "current");
  assertEquals(current.update_available, false);
});

Deno.test("database schema inspection blocks wrong projects and incompatible vectors", () => {
  const definition = define_database_schema({
    project_id: "iam-pager",
    schemas: [{
      schema_id: "pages",
      baseline_version: 2,
      target_version: 2,
    }],
    migrations: [],
  });

  assertEquals(
    inspect_database_schema(manifest([], "other-project"), definition).health,
    "wrong_project",
  );

  for (
    const supplied of [
      manifest([]),
      manifest([{ schema_id: "pages", version: 1 }]),
      manifest([{ schema_id: "pages", version: 3 }]),
      manifest([
        { schema_id: "pages", version: 2 },
        { schema_id: "unknown", version: 1 },
      ]),
    ]
  ) {
    const report = inspect_database_schema(supplied, definition);
    assertEquals(report.health, "incompatible");
    assertEquals(report.update_available, false);
  }
});

Deno.test("manual database schema manager initializes an explicitly selected legacy database", async () => {
  const definition = define_database_schema({
    project_id: "iam-pager",
    schemas: [
      { schema_id: "pages", baseline_version: 1, target_version: 1 },
      { schema_id: "sessions", baseline_version: 1, target_version: 1 },
    ],
    migrations: [],
  });
  const store = new MemoryManifestStore(null);
  const manager = new ManualDatabaseSchemaManager({
    definition,
    manifest_store: store,
  });

  const updated = await manager.update(undefined);
  assertEquals(updated, {
    outcome: "updated",
    initialized_manifest: true,
    migrations: [],
  });
  assertEquals(
    store.manifest,
    manifest([
      { schema_id: "pages", version: 1 },
      { schema_id: "sessions", version: 1 },
    ]),
  );
  assertEquals((await manager.inspect()).health, "current");
  assertEquals((await manager.update(undefined)).outcome, "no_change");
  assertEquals(store.writes, 1);
});

Deno.test("manual database schema manager runs retained migrations before publishing", async () => {
  const calls: string[] = [];
  const definition = define_database_schema<string[]>({
    project_id: "iam-pager",
    schemas: [{
      schema_id: "pages",
      baseline_version: 1,
      target_version: 3,
    }],
    migrations: [
      {
        migration_id: "pages-v1-to-v2",
        schema_id: "pages",
        from_version: 1,
        to_version: 2,
        description: "add index",
        migrate: (context) => {
          context.push("v2");
        },
      },
      {
        migration_id: "pages-v2-to-v3",
        schema_id: "pages",
        from_version: 2,
        to_version: 3,
        description: "backfill index",
        migrate: (context) => {
          context.push("v3");
        },
      },
    ],
  });
  const store = new MemoryManifestStore(
    manifest([{ schema_id: "pages", version: 1 }]),
  );
  const manager = new ManualDatabaseSchemaManager({
    definition,
    manifest_store: store,
  });

  const updated = await manager.update(calls);
  assertEquals(calls, ["v2", "v3"]);
  assertEquals(
    updated.migrations.map((migration) => migration.migration_id),
    ["pages-v1-to-v2", "pages-v2-to-v3"],
  );
  assertEquals(store.manifest, manifest([{ schema_id: "pages", version: 3 }]));
});

Deno.test("failed or racing manual migrations never publish success", async () => {
  const failing_definition = define_database_schema({
    project_id: "iam-pager",
    schemas: [{
      schema_id: "pages",
      baseline_version: 1,
      target_version: 2,
    }],
    migrations: [{
      migration_id: "pages-v1-to-v2",
      schema_id: "pages",
      from_version: 1,
      to_version: 2,
      description: "failing migration",
      migrate: () => {
        throw new Error("raw failure must not escape");
      },
    }],
  });
  const initial = manifest([{ schema_id: "pages", version: 1 }]);
  const failing_store = new MemoryManifestStore(initial);
  const failing_manager = new ManualDatabaseSchemaManager({
    definition: failing_definition,
    manifest_store: failing_store,
  });
  const failure = await assertRejects(
    () => failing_manager.update(undefined),
    DatabaseSchemaError,
  );
  assertEquals(failure.code, "migration_failed");
  assertEquals(failing_store.manifest, initial);
  assertEquals(failing_store.writes, 0);

  const racing_store = new MemoryManifestStore(initial);
  racing_store.conflict = true;
  // Replace the failing migration for this path with a successful one.
  const successful_manager = new ManualDatabaseSchemaManager({
    definition: define_database_schema({
      ...failing_definition,
      migrations: [{
        ...failing_definition.migrations[0],
        migrate: () => {},
      }],
    }),
    manifest_store: racing_store,
  });
  const conflict = await assertRejects(
    () => successful_manager.update(undefined),
    DatabaseSchemaError,
  );
  assertEquals(conflict.code, "manifest_conflict");
  assertEquals(racing_store.manifest, initial);
});
