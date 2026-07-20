import {
  database_schema_manifests_equal,
  DatabaseSchemaError,
  type DatabaseSchemaManifest,
  type DatabaseSchemaManifestStore,
  type DatabaseSchemaManifestWriteResult,
  define_database_schema_manifest,
} from "./schema.ts";

const manifest_key: Deno.KvKey = ["database-schema", "v1", "manifest"];
const stored_manifest_schema_version = 1;

interface StoredDatabaseSchemaManifest {
  readonly schema_version: 1;
  readonly project_id: string;
  readonly schema_versions: readonly {
    readonly schema_id: string;
    readonly version: number;
  }[];
}

function has_exact_keys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sorted_expected = [...expected].sort();
  return actual.length === sorted_expected.length &&
    actual.every((key, index) => key === sorted_expected[index]);
}

function encode_manifest(
  manifest: DatabaseSchemaManifest,
): StoredDatabaseSchemaManifest {
  return {
    schema_version: stored_manifest_schema_version,
    project_id: manifest.project_id,
    schema_versions: manifest.schema_versions.map((version) => ({
      schema_id: version.schema_id,
      version: version.version,
    })),
  };
}

function decode_manifest(value: unknown): DatabaseSchemaManifest {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    !has_exact_keys(value as Record<string, unknown>, [
      "schema_version",
      "project_id",
      "schema_versions",
    ])
  ) {
    throw new DatabaseSchemaError("invalid_manifest");
  }
  const stored = value as Record<string, unknown>;
  if (
    stored.schema_version !== stored_manifest_schema_version ||
    !Array.isArray(stored.schema_versions)
  ) {
    throw new DatabaseSchemaError("invalid_manifest");
  }

  const schema_versions = stored.schema_versions.map((version) => {
    if (
      version === null || typeof version !== "object" ||
      Array.isArray(version) ||
      !has_exact_keys(version as Record<string, unknown>, [
        "schema_id",
        "version",
      ])
    ) {
      throw new DatabaseSchemaError("invalid_manifest");
    }
    const stored_version = version as Record<string, unknown>;
    return {
      schema_id: stored_version.schema_id as string,
      version: stored_version.version as number,
    };
  });

  return define_database_schema_manifest({
    project_id: stored.project_id as string,
    schema_versions,
  });
}

export function database_schema_manifest_key(): Deno.KvKey {
  return [...manifest_key];
}

/** Deno KV adapter for the single manual-task manifest. */
export class DenoKvDatabaseSchemaManifestStore
  implements DatabaseSchemaManifestStore {
  readonly #kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.#kv = kv;
  }

  async read_manifest(): Promise<DatabaseSchemaManifest | null> {
    const entry = await this.#kv.get<unknown>(manifest_key);
    return entry.versionstamp === null ? null : decode_manifest(entry.value);
  }

  async write_manifest(input: {
    readonly expected_manifest: DatabaseSchemaManifest | null;
    readonly manifest: DatabaseSchemaManifest;
  }): Promise<DatabaseSchemaManifestWriteResult> {
    const expected_manifest = input.expected_manifest === null
      ? null
      : define_database_schema_manifest(input.expected_manifest);
    const manifest = define_database_schema_manifest(input.manifest);
    const entry = await this.#kv.get<unknown>(manifest_key);
    const current_manifest = entry.versionstamp === null
      ? null
      : decode_manifest(entry.value);
    if (!database_schema_manifests_equal(current_manifest, expected_manifest)) {
      return "conflict";
    }

    const result = await this.#kv.atomic()
      .check(entry)
      .set(manifest_key, encode_manifest(manifest))
      .commit();
    return result.ok ? "written" : "conflict";
  }
}
