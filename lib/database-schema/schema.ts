export interface DatabaseSchemaVersion {
  readonly schema_id: string;
  readonly version: number;
}

export interface DatabaseSchemaManifest {
  readonly project_id: string;
  readonly schema_versions: readonly DatabaseSchemaVersion[];
}

export interface DatabaseSchemaTarget {
  readonly schema_id: string;
  /** Existing unversioned databases are assumed to use this record format. */
  readonly baseline_version: number;
  readonly target_version: number;
}

/** A retained manual migration. Implementations must be safe to run again. */
export interface DatabaseSchemaMigration<Context> {
  readonly migration_id: string;
  readonly schema_id: string;
  readonly from_version: number;
  readonly to_version: number;
  readonly description: string;
  migrate(context: Context): void | Promise<void>;
}

export interface DatabaseSchemaDefinition<Context> {
  readonly project_id: string;
  readonly schemas: readonly DatabaseSchemaTarget[];
  readonly migrations: readonly DatabaseSchemaMigration<Context>[];
}

export type DatabaseSchemaManifestWriteResult = "written" | "conflict";

/** Minimal persistence boundary used only by explicit database tasks. */
export interface DatabaseSchemaManifestStore {
  read_manifest(): Promise<DatabaseSchemaManifest | null>;
  write_manifest(input: {
    readonly expected_manifest: DatabaseSchemaManifest | null;
    readonly manifest: DatabaseSchemaManifest;
  }): Promise<DatabaseSchemaManifestWriteResult>;
}

export type DatabaseSchemaEntryStatus =
  | "current"
  | "stale"
  | "future"
  | "unsupported"
  | "missing"
  | "unknown"
  | "unversioned";

export interface DatabaseSchemaEntryReport {
  readonly schema_id: string;
  readonly current_version: number | null;
  readonly target_version: number | null;
  readonly status: DatabaseSchemaEntryStatus;
}

export type DatabaseSchemaHealth =
  | "current"
  | "unversioned"
  | "stale"
  | "wrong_project"
  | "incompatible";

export interface DatabaseSchemaReport {
  readonly expected_project_id: string;
  readonly manifest_project_id: string | null;
  readonly health: DatabaseSchemaHealth;
  readonly update_available: boolean;
  readonly schemas: readonly DatabaseSchemaEntryReport[];
}

export interface AppliedDatabaseSchemaMigration {
  readonly migration_id: string;
  readonly schema_id: string;
  readonly from_version: number;
  readonly to_version: number;
  readonly description: string;
}

export interface DatabaseSchemaUpdateReport {
  readonly outcome: "updated" | "no_change";
  readonly initialized_manifest: boolean;
  readonly migrations: readonly AppliedDatabaseSchemaMigration[];
}

export type DatabaseSchemaErrorCode =
  | "invalid_definition"
  | "invalid_manifest"
  | "manifest_store_failed"
  | "update_unavailable"
  | "migration_failed"
  | "manifest_conflict";

export class DatabaseSchemaError extends Error {
  readonly code: DatabaseSchemaErrorCode;
  readonly schema_id?: string;
  readonly migration_id?: string;
  readonly from_version?: number;
  readonly to_version?: number;

  constructor(
    code: DatabaseSchemaErrorCode,
    details: {
      readonly schema_id?: string;
      readonly migration_id?: string;
      readonly from_version?: number;
      readonly to_version?: number;
    } = {},
  ) {
    super(code);
    this.name = "DatabaseSchemaError";
    this.code = code;
    this.schema_id = details.schema_id;
    this.migration_id = details.migration_id;
    this.from_version = details.from_version;
    this.to_version = details.to_version;
  }
}

const identifier_pattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const max_identifier_length = 80;
const max_schemas = 64;

function valid_identifier(value: unknown): value is string {
  return typeof value === "string" && value.length <= max_identifier_length &&
    identifier_pattern.test(value);
}

function valid_version(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function invalid_definition(): never {
  throw new DatabaseSchemaError("invalid_definition");
}

function immutable_version(
  supplied: DatabaseSchemaVersion,
): DatabaseSchemaVersion {
  if (
    supplied === null || typeof supplied !== "object" ||
    !valid_identifier(supplied.schema_id) || !valid_version(supplied.version)
  ) {
    throw new DatabaseSchemaError("invalid_manifest");
  }
  return Object.freeze({
    schema_id: supplied.schema_id,
    version: supplied.version,
  });
}

export function define_database_schema_manifest(
  supplied: DatabaseSchemaManifest,
): DatabaseSchemaManifest {
  if (
    supplied === null || typeof supplied !== "object" ||
    !valid_identifier(supplied.project_id) ||
    !Array.isArray(supplied.schema_versions) ||
    supplied.schema_versions.length > max_schemas
  ) {
    throw new DatabaseSchemaError("invalid_manifest");
  }

  const schema_ids = new Set<string>();
  const schema_versions = supplied.schema_versions.map((version) => {
    const normalized = immutable_version(version);
    if (schema_ids.has(normalized.schema_id)) {
      throw new DatabaseSchemaError("invalid_manifest");
    }
    schema_ids.add(normalized.schema_id);
    return normalized;
  });
  schema_versions.sort((left, right) =>
    left.schema_id.localeCompare(right.schema_id)
  );
  return Object.freeze({
    project_id: supplied.project_id,
    schema_versions: Object.freeze(schema_versions),
  });
}

export function database_schema_manifests_equal(
  left: DatabaseSchemaManifest | null,
  right: DatabaseSchemaManifest | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.project_id === right.project_id &&
    left.schema_versions.length === right.schema_versions.length &&
    left.schema_versions.every((version, index) =>
      version.schema_id === right.schema_versions[index].schema_id &&
      version.version === right.schema_versions[index].version
    );
}

export function define_database_schema<Context>(
  supplied: DatabaseSchemaDefinition<Context>,
): DatabaseSchemaDefinition<Context> {
  if (
    supplied === null || typeof supplied !== "object" ||
    !valid_identifier(supplied.project_id) ||
    !Array.isArray(supplied.schemas) || supplied.schemas.length === 0 ||
    supplied.schemas.length > max_schemas ||
    !Array.isArray(supplied.migrations)
  ) {
    invalid_definition();
  }

  const schema_ids = new Set<string>();
  const schemas = supplied.schemas.map((schema) => {
    if (
      schema === null || typeof schema !== "object" ||
      !valid_identifier(schema.schema_id) ||
      schema_ids.has(schema.schema_id) ||
      !valid_version(schema.baseline_version) ||
      !valid_version(schema.target_version) ||
      schema.target_version < schema.baseline_version
    ) {
      invalid_definition();
    }
    schema_ids.add(schema.schema_id);
    return Object.freeze({
      schema_id: schema.schema_id,
      baseline_version: schema.baseline_version,
      target_version: schema.target_version,
    });
  });
  schemas.sort((left, right) => left.schema_id.localeCompare(right.schema_id));

  const migration_ids = new Set<string>();
  const migrations = supplied.migrations.map((migration) => {
    if (
      migration === null || typeof migration !== "object" ||
      !valid_identifier(migration.migration_id) ||
      migration_ids.has(migration.migration_id) ||
      !schema_ids.has(migration.schema_id) ||
      !valid_version(migration.from_version) ||
      migration.to_version !== migration.from_version + 1 ||
      typeof migration.description !== "string" ||
      migration.description.length === 0 ||
      migration.description.length > 200 ||
      migration.description.trim() !== migration.description ||
      typeof migration.migrate !== "function"
    ) {
      invalid_definition();
    }
    migration_ids.add(migration.migration_id);
    return Object.freeze({
      migration_id: migration.migration_id,
      schema_id: migration.schema_id,
      from_version: migration.from_version,
      to_version: migration.to_version,
      description: migration.description,
      migrate: migration.migrate,
    });
  });
  migrations.sort((left, right) =>
    left.schema_id.localeCompare(right.schema_id) ||
    left.from_version - right.from_version
  );

  for (const schema of schemas) {
    const path = migrations.filter((migration) =>
      migration.schema_id === schema.schema_id
    );
    if (path.length !== schema.target_version - schema.baseline_version) {
      invalid_definition();
    }
    for (let index = 0; index < path.length; index += 1) {
      const from_version = schema.baseline_version + index;
      if (
        path[index].from_version !== from_version ||
        path[index].to_version !== from_version + 1
      ) {
        invalid_definition();
      }
    }
  }

  return Object.freeze({
    project_id: supplied.project_id,
    schemas: Object.freeze(schemas),
    migrations: Object.freeze(migrations),
  });
}

export function target_database_schema_manifest<Context>(
  definition: DatabaseSchemaDefinition<Context>,
): DatabaseSchemaManifest {
  return define_database_schema_manifest({
    project_id: definition.project_id,
    schema_versions: definition.schemas.map((schema) => ({
      schema_id: schema.schema_id,
      version: schema.target_version,
    })),
  });
}

export function inspect_database_schema<Context>(
  supplied_manifest: DatabaseSchemaManifest | null,
  supplied_definition: DatabaseSchemaDefinition<Context>,
): DatabaseSchemaReport {
  const definition = define_database_schema(supplied_definition);
  if (supplied_manifest === null) {
    return Object.freeze({
      expected_project_id: definition.project_id,
      manifest_project_id: null,
      health: "unversioned",
      update_available: true,
      schemas: Object.freeze(definition.schemas.map((schema) =>
        Object.freeze({
          schema_id: schema.schema_id,
          current_version: null,
          target_version: schema.target_version,
          status: "unversioned" as const,
        })
      )),
    });
  }

  const manifest = define_database_schema_manifest(supplied_manifest);
  if (manifest.project_id !== definition.project_id) {
    return Object.freeze({
      expected_project_id: definition.project_id,
      manifest_project_id: manifest.project_id,
      health: "wrong_project",
      update_available: false,
      schemas: Object.freeze([]),
    });
  }

  const current_versions = new Map(
    manifest.schema_versions.map((version) => [
      version.schema_id,
      version.version,
    ]),
  );
  const targets = new Map(
    definition.schemas.map((schema) => [schema.schema_id, schema]),
  );
  const schemas: DatabaseSchemaEntryReport[] = [];
  let stale = false;
  let incompatible = false;

  for (const target of definition.schemas) {
    const current_version = current_versions.get(target.schema_id);
    let status: DatabaseSchemaEntryStatus;
    if (current_version === undefined) {
      status = "missing";
      incompatible = true;
    } else if (current_version === target.target_version) {
      status = "current";
    } else if (current_version > target.target_version) {
      status = "future";
      incompatible = true;
    } else if (current_version < target.baseline_version) {
      status = "unsupported";
      incompatible = true;
    } else {
      status = "stale";
      stale = true;
    }
    schemas.push(Object.freeze({
      schema_id: target.schema_id,
      current_version: current_version ?? null,
      target_version: target.target_version,
      status,
    }));
  }

  for (const version of manifest.schema_versions) {
    if (targets.has(version.schema_id)) continue;
    incompatible = true;
    schemas.push(Object.freeze({
      schema_id: version.schema_id,
      current_version: version.version,
      target_version: null,
      status: "unknown",
    }));
  }
  schemas.sort((left, right) => left.schema_id.localeCompare(right.schema_id));

  const health: DatabaseSchemaHealth = incompatible
    ? "incompatible"
    : stale
    ? "stale"
    : "current";
  return Object.freeze({
    expected_project_id: definition.project_id,
    manifest_project_id: manifest.project_id,
    health,
    update_available: health === "stale",
    schemas: Object.freeze(schemas),
  });
}

export interface DatabaseSchemaManager<Context> {
  inspect(): Promise<DatabaseSchemaReport>;
  update(context: Context): Promise<DatabaseSchemaUpdateReport>;
}

/**
 * Manual, forward-only runner. It deliberately has no deploy/runtime hook and
 * no durable lock: retained migrations are idempotent, then one manifest CAS
 * publishes success. A failed or racing invocation is safe to inspect/rerun.
 */
export class ManualDatabaseSchemaManager<Context>
  implements DatabaseSchemaManager<Context> {
  readonly #definition: DatabaseSchemaDefinition<Context>;
  readonly #manifest_store: DatabaseSchemaManifestStore;

  constructor(options: {
    readonly definition: DatabaseSchemaDefinition<Context>;
    readonly manifest_store: DatabaseSchemaManifestStore;
  }) {
    this.#definition = define_database_schema(options.definition);
    this.#manifest_store = options.manifest_store;
  }

  async inspect(): Promise<DatabaseSchemaReport> {
    return inspect_database_schema(
      await this.#read_manifest(),
      this.#definition,
    );
  }

  async update(context: Context): Promise<DatabaseSchemaUpdateReport> {
    const initial_manifest = await this.#read_manifest();
    const report = inspect_database_schema(initial_manifest, this.#definition);
    if (report.health === "current") {
      return Object.freeze({
        outcome: "no_change",
        initialized_manifest: false,
        migrations: Object.freeze([]),
      });
    }
    if (!report.update_available) {
      throw new DatabaseSchemaError("update_unavailable");
    }

    const versions = new Map<string, number>();
    if (initial_manifest === null) {
      for (const schema of this.#definition.schemas) {
        versions.set(schema.schema_id, schema.baseline_version);
      }
    } else {
      for (const version of initial_manifest.schema_versions) {
        versions.set(version.schema_id, version.version);
      }
    }

    const applied: AppliedDatabaseSchemaMigration[] = [];
    for (const migration of this.#definition.migrations) {
      const current_version = versions.get(migration.schema_id);
      if (
        current_version === undefined ||
        current_version >= migration.to_version
      ) {
        continue;
      }
      if (current_version !== migration.from_version) {
        throw new DatabaseSchemaError("update_unavailable", {
          schema_id: migration.schema_id,
        });
      }
      try {
        await migration.migrate(context);
      } catch {
        throw new DatabaseSchemaError("migration_failed", {
          schema_id: migration.schema_id,
          migration_id: migration.migration_id,
          from_version: migration.from_version,
          to_version: migration.to_version,
        });
      }
      versions.set(migration.schema_id, migration.to_version);
      applied.push(Object.freeze({
        migration_id: migration.migration_id,
        schema_id: migration.schema_id,
        from_version: migration.from_version,
        to_version: migration.to_version,
        description: migration.description,
      }));
    }

    let write_result: DatabaseSchemaManifestWriteResult;
    try {
      write_result = await this.#manifest_store.write_manifest({
        expected_manifest: initial_manifest,
        manifest: target_database_schema_manifest(this.#definition),
      });
    } catch (error) {
      if (error instanceof DatabaseSchemaError) throw error;
      throw new DatabaseSchemaError("manifest_store_failed");
    }
    if (write_result !== "written") {
      throw new DatabaseSchemaError("manifest_conflict");
    }

    return Object.freeze({
      outcome: "updated",
      initialized_manifest: initial_manifest === null,
      migrations: Object.freeze(applied),
    });
  }

  async #read_manifest(): Promise<DatabaseSchemaManifest | null> {
    try {
      const manifest = await this.#manifest_store.read_manifest();
      return manifest === null
        ? null
        : define_database_schema_manifest(manifest);
    } catch (error) {
      if (error instanceof DatabaseSchemaError) throw error;
      throw new DatabaseSchemaError("manifest_store_failed");
    }
  }
}
