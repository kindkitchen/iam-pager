import { assertEquals, assertRejects } from "@std/assert";
import { KvToolboxGateway } from "../storage/kv-toolbox-gateway.ts";
import {
  database_schema_manifest_key,
  DenoKvDatabaseSchemaManifestStore,
} from "./deno-kv-store.ts";
import { DatabaseSchemaError } from "./schema.ts";

function gateway(kv: Deno.Kv): KvToolboxGateway {
  return new KvToolboxGateway(kv);
}

Deno.test("Deno KV schema store reads the existing manifest format and writes with CAS", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const key = database_schema_manifest_key();
    await kv.set(key, {
      schema_version: 1,
      project_id: "iam-pager",
      schema_versions: [
        { schema_id: "sessions", version: 1 },
        { schema_id: "pages", version: 1 },
      ],
    });
    const store = new DenoKvDatabaseSchemaManifestStore(gateway(kv));
    const initial = await store.read_manifest();
    assertEquals(initial, {
      project_id: "iam-pager",
      schema_versions: [
        { schema_id: "pages", version: 1 },
        { schema_id: "sessions", version: 1 },
      ],
    });

    const next = {
      project_id: "iam-pager",
      schema_versions: [
        { schema_id: "pages", version: 2 },
        { schema_id: "sessions", version: 1 },
      ],
    } as const;
    assertEquals(
      await store.write_manifest({
        expected_manifest: initial,
        manifest: next,
      }),
      "written",
    );
    assertEquals(await store.read_manifest(), next);
    assertEquals(
      await store.write_manifest({
        expected_manifest: initial,
        manifest: next,
      }),
      "conflict",
    );
  } finally {
    kv.close();
  }
});

Deno.test("Deno KV schema store rejects malformed metadata without rewriting it", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const key = database_schema_manifest_key();
    const malformed = {
      schema_version: 2,
      project_id: "iam-pager",
      schema_versions: [],
    };
    await kv.set(key, malformed);
    const store = new DenoKvDatabaseSchemaManifestStore(gateway(kv));
    await assertRejects(
      () => store.read_manifest(),
      DatabaseSchemaError,
    );
    assertEquals((await kv.get(key)).value, malformed);
  } finally {
    kv.close();
  }
});
