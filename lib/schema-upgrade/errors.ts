export type SchemaUpgradeErrorCode =
  | "invalid_plan"
  | "invalid_state"
  | "unsupported_version"
  | "future_version"
  | "unknown_pending_transition"
  | "coordination_conflict"
  | "step_failed"
  | "state_repository_failed"
  | "invalid_configuration"
  | "database_unavailable"
  | "database_close_failed";

export interface SchemaUpgradeErrorDetails {
  readonly schema_id?: string;
  readonly step_id?: string;
  readonly from_version?: number;
  readonly to_version?: number;
}

const safe_messages: Readonly<Record<SchemaUpgradeErrorCode, string>> = {
  invalid_plan: "database schema upgrade plan is invalid",
  invalid_state: "database schema upgrade state is invalid",
  unsupported_version: "database schema version is no longer supported",
  future_version: "database schema is newer than this application",
  unknown_pending_transition:
    "database schema has an unknown pending transition",
  coordination_conflict:
    "database schema upgrade coordination did not converge",
  step_failed: "database schema upgrade step failed",
  state_repository_failed: "database schema upgrade state operation failed",
  invalid_configuration: "database schema upgrade configuration is invalid",
  database_unavailable: "database for schema upgrades is unavailable",
  database_close_failed: "database for schema upgrades could not be closed",
};

/** Error metadata is deliberately limited to safe schema diagnostics. */
export class SchemaUpgradeError extends Error {
  readonly code: SchemaUpgradeErrorCode;
  readonly schema_id?: string;
  readonly step_id?: string;
  readonly from_version?: number;
  readonly to_version?: number;

  constructor(
    code: SchemaUpgradeErrorCode,
    details: SchemaUpgradeErrorDetails = {},
  ) {
    super(safe_messages[code]);
    this.name = "SchemaUpgradeError";
    this.code = code;
    this.schema_id = details.schema_id;
    this.step_id = details.step_id;
    this.from_version = details.from_version;
    this.to_version = details.to_version;
  }
}
