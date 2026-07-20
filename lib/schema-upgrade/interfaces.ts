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
