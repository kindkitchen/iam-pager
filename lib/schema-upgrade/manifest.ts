import { SchemaUpgradeError, type SchemaUpgradeErrorCode } from "./errors.ts";
import type {
  DatabaseSchemaManifest,
  DatabaseSchemaVersion,
} from "./interfaces.ts";
import {
  is_schema_upgrade_identifier,
  is_schema_upgrade_version,
  max_schema_upgrade_plans,
} from "./plan.ts";

function invalid(code: SchemaUpgradeErrorCode): never {
  throw new SchemaUpgradeError(code);
}

export function define_database_schema_versions(
  supplied_versions: readonly DatabaseSchemaVersion[],
  options: {
    readonly allow_zero?: boolean;
    readonly error_code?: SchemaUpgradeErrorCode;
  } = {},
): readonly DatabaseSchemaVersion[] {
  const error_code = options.error_code ?? "invalid_manifest";
  if (
    !Array.isArray(supplied_versions) ||
    supplied_versions.length > max_schema_upgrade_plans
  ) {
    invalid(error_code);
  }

  const schema_ids = new Set<string>();
  const versions: DatabaseSchemaVersion[] = [];
  for (const supplied_version of supplied_versions) {
    const version_is_valid = options.allow_zero
      ? Number.isSafeInteger(supplied_version?.version) &&
        supplied_version.version >= 0
      : is_schema_upgrade_version(supplied_version?.version);
    if (
      supplied_version === null || typeof supplied_version !== "object" ||
      !is_schema_upgrade_identifier(supplied_version.schema_id) ||
      schema_ids.has(supplied_version.schema_id) ||
      !version_is_valid
    ) {
      invalid(error_code);
    }
    schema_ids.add(supplied_version.schema_id);
    versions.push(Object.freeze({
      schema_id: supplied_version.schema_id,
      version: supplied_version.version,
    }));
  }

  versions.sort((left, right) => left.schema_id.localeCompare(right.schema_id));
  return Object.freeze(versions);
}

export function define_database_schema_manifest(
  supplied_manifest: DatabaseSchemaManifest,
): DatabaseSchemaManifest {
  if (
    supplied_manifest === null || typeof supplied_manifest !== "object" ||
    !is_schema_upgrade_identifier(supplied_manifest.project_id)
  ) {
    invalid("invalid_manifest");
  }
  return Object.freeze({
    project_id: supplied_manifest.project_id,
    schema_versions: define_database_schema_versions(
      supplied_manifest.schema_versions,
    ),
  });
}

export function database_schema_versions_equal(
  left: readonly DatabaseSchemaVersion[],
  right: readonly DatabaseSchemaVersion[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((version, index) =>
    version.schema_id === right[index].schema_id &&
    version.version === right[index].version
  );
}

export function database_schema_manifests_equal(
  left: DatabaseSchemaManifest,
  right: DatabaseSchemaManifest,
): boolean {
  return left.project_id === right.project_id &&
    database_schema_versions_equal(left.schema_versions, right.schema_versions);
}
