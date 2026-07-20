export interface SchemaUpgradeTransition {
  readonly step_id: string;
  readonly from_version: number;
  readonly to_version: number;
}

/** Durable state keeps the completed version separate from an unfinished step. */
export interface SchemaUpgradeState {
  readonly current_version: number;
  readonly pending_transition: SchemaUpgradeTransition | null;
}

export type SchemaUpgradeStateMutationResult = "applied" | "conflict";

export interface DatabaseSchemaVersion {
  readonly schema_id: string;
  readonly version: number;
}

/** Authoritative identity and complete published version vector for one DB. */
export interface DatabaseSchemaManifest {
  readonly project_id: string;
  readonly schema_versions: readonly DatabaseSchemaVersion[];
}

/** Storage-neutral compare-and-set boundary for manifest publication. */
export interface DatabaseSchemaManifestRepository {
  read_manifest(): Promise<DatabaseSchemaManifest | null>;

  initialize_manifest(
    manifest: DatabaseSchemaManifest,
  ): Promise<SchemaUpgradeStateMutationResult>;

  replace_manifest(input: {
    readonly expected_manifest: DatabaseSchemaManifest;
    readonly manifest: DatabaseSchemaManifest;
  }): Promise<SchemaUpgradeStateMutationResult>;
}

/**
 * Storage-neutral compare-and-set boundary for schema progress.
 *
 * Implementations must initialize only an absent state, claim only an exact
 * completed version with no pending transition, and complete only the exact
 * persisted transition supplied by the caller.
 */
export interface SchemaUpgradeStateRepository {
  read_state(schema_id: string): Promise<SchemaUpgradeState | null>;

  initialize_state(input: {
    readonly schema_id: string;
    readonly baseline_version: number;
  }): Promise<SchemaUpgradeStateMutationResult>;

  claim_transition(input: {
    readonly schema_id: string;
    readonly expected_current_version: number;
    readonly transition: SchemaUpgradeTransition;
  }): Promise<SchemaUpgradeStateMutationResult>;

  complete_transition(input: {
    readonly schema_id: string;
    readonly transition: SchemaUpgradeTransition;
  }): Promise<SchemaUpgradeStateMutationResult>;
}

/** One retained, forward-only transformation. It must be idempotent. */
export interface SchemaUpgradeStep<Context> extends SchemaUpgradeTransition {
  upgrade(context: Context): void | Promise<void>;
}

export interface SchemaUpgradePlan<Context> {
  readonly schema_id: string;
  /** Version assumed when framework metadata is absent. */
  readonly baseline_version: number;
  readonly target_version: number;
  readonly steps: readonly SchemaUpgradeStep<Context>[];
}

export type SchemaUpgradeOutcome = "upgraded" | "resumed" | "no_change";

export interface SchemaUpgradeTransitionReport extends SchemaUpgradeTransition {
  readonly execution: "upgraded" | "resumed";
}

export interface SchemaUpgradeReport {
  readonly schema_id: string;
  readonly initial_version: number;
  readonly target_version: number;
  readonly outcome: SchemaUpgradeOutcome;
  readonly transitions: readonly SchemaUpgradeTransitionReport[];
}

export interface DatabaseSchemaUpgradeReport {
  readonly schemas: readonly SchemaUpgradeReport[];
}

export interface DatabaseSchemaUpgrader<Context> {
  upgrade(context: Context): Promise<DatabaseSchemaUpgradeReport>;
}

export type DatabaseSchemaVersionOutcome =
  | "current"
  | "stale"
  | "future"
  | "pending"
  | "unversioned";

export interface DatabaseSchemaVersionReport extends DatabaseSchemaVersion {
  readonly target_version: number;
  readonly outcome: DatabaseSchemaVersionOutcome;
}

export type DatabaseSchemaCheckOutcome =
  | DatabaseSchemaVersionOutcome
  | "wrong_project";

export interface DatabaseSchemaCheckReport {
  readonly project_id: string;
  readonly outcome: DatabaseSchemaCheckOutcome;
  readonly schemas: readonly DatabaseSchemaVersionReport[];
}

export interface DatabaseSchemaVersionChecker {
  check(): Promise<DatabaseSchemaCheckReport>;
}

export interface DatabaseSchemaWriteRequest {
  readonly project_id: string;
  /** Version 0 is permitted only when the durable manifest is absent. */
  readonly from_versions: readonly DatabaseSchemaVersion[];
  readonly to_versions: readonly DatabaseSchemaVersion[];
}

export interface DatabaseSchemaWriteReport {
  readonly project_id: string;
  readonly from_versions: readonly DatabaseSchemaVersion[];
  readonly to_versions: readonly DatabaseSchemaVersion[];
  readonly upgrade: DatabaseSchemaUpgradeReport;
}

export interface DatabaseSchemaWriter<Context> {
  write(
    request: DatabaseSchemaWriteRequest,
    context: Context,
  ): Promise<DatabaseSchemaWriteReport>;
}
