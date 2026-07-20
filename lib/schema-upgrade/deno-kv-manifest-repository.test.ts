import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import {
  deno_kv_database_schema_manifest_key,
  DenoKvDatabaseSchemaManifestRepository,
} from "./deno-kv-manifest-repository.ts";
import { SchemaUpgradeError } from "./errors.ts";
import { test_database_schema_manifest_repository_conformance } from "./manifest-repository-conformance.ts";

const conformance_handles = new WeakMap<object, Deno.Kv>();

test_database_schema_manifest_repository_conformance({
  name: "DenoKvDatabaseSchemaManifestRepository",
  make_repository: async () => {
    const kv = await Deno.openKv(":memory:");
    const repository = new DenoKvDatabaseSchemaManifestRepository(kv);
    conformance_handles.set(repository, kv);
    return repository;
  },
  teardown: (repository) => {
    conformance_handles.get(repository)?.close();
    conformance_handles.delete(repository);
  },
});

Deno.test("Deno KV database manifest persists across adapter instances", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const writer = new DenoKvDatabaseSchemaManifestRepository(kv);
    await writer.initialize_manifest({
      project_id: "iam-pager",
      schema_versions: [
        { schema_id: "pages", version: 1 },
        { schema_id: "ownership", version: 1 },
      ],
    });

    const reader = new DenoKvDatabaseSchemaManifestRepository(kv);
    assertEquals(await reader.read_manifest(), {
      project_id: "iam-pager",
      schema_versions: [
        { schema_id: "ownership", version: 1 },
        { schema_id: "pages", version: 1 },
      ],
    });
    assertEquals(
      (await kv.get(deno_kv_database_schema_manifest_key())).value,
      {
        schema_version: 1,
        project_id: "iam-pager",
        schema_versions: [
          { schema_id: "ownership", version: 1 },
          { schema_id: "pages", version: 1 },
        ],
      },
    );
  } finally {
    kv.close();
  }
});

Deno.test("Deno KV database manifest rejects corrupt values safely", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await kv.set(deno_kv_database_schema_manifest_key(), {
      schema_version: 1,
      project_id: "iam-pager",
      schema_versions: [{ schema_id: "pages", version: 0 }],
      secret: "must-not-appear",
    });
    const repository = new DenoKvDatabaseSchemaManifestRepository(kv);
    const error = await assertRejects(() => repository.read_manifest());
    assertInstanceOf(error, SchemaUpgradeError);
    assertEquals(error.code, "invalid_manifest");
    assertEquals(error.message.includes("must-not-appear"), false);
  } finally {
    kv.close();
  }
});
