import { SchemaUpgradeError } from "./errors.ts";
import type {
  SchemaUpgradeState,
  SchemaUpgradeStateMutationResult,
  SchemaUpgradeStateRepository,
  SchemaUpgradeTransition,
} from "./interfaces.ts";
import {
  is_schema_upgrade_identifier,
  is_schema_upgrade_version,
} from "./plan.ts";

const stored_state_schema_version = 1;
const state_prefix: Deno.KvKey = [
  "iam-pager",
  "schema-upgrades",
  "v1",
  "states",
];

interface StoredSchemaUpgradeState {
  readonly schema_version: 1;
  readonly schema_id: string;
  readonly current_version: number;
  readonly pending_transition: SchemaUpgradeTransition | null;
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

function invalid_input(): never {
  throw new TypeError("schema upgrade state repository input is invalid");
}

function require_schema_id(schema_id: string): void {
  if (!is_schema_upgrade_identifier(schema_id)) invalid_input();
}

function require_version(version: number): void {
  if (!is_schema_upgrade_version(version)) invalid_input();
}

function require_transition(
  transition: SchemaUpgradeTransition,
  expected_from_version?: number,
): void {
  if (
    transition === null || typeof transition !== "object" ||
    !is_schema_upgrade_identifier(transition.step_id) ||
    !is_schema_upgrade_version(transition.from_version) ||
    !is_schema_upgrade_version(transition.to_version) ||
    transition.to_version !== transition.from_version + 1 ||
    (expected_from_version !== undefined &&
      transition.from_version !== expected_from_version)
  ) {
    invalid_input();
  }
}

export function deno_kv_schema_upgrade_state_key(
  schema_id: string,
): Deno.KvKey {
  require_schema_id(schema_id);
  return [...state_prefix, schema_id];
}

function stored_state(
  schema_id: string,
  current_version: number,
  pending_transition: SchemaUpgradeTransition | null,
): StoredSchemaUpgradeState {
  return {
    schema_version: stored_state_schema_version,
    schema_id,
    current_version,
    pending_transition: pending_transition === null ? null : {
      step_id: pending_transition.step_id,
      from_version: pending_transition.from_version,
      to_version: pending_transition.to_version,
    },
  };
}

function decode_state(
  expected_schema_id: string,
  value: unknown,
): SchemaUpgradeState {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    !has_exact_keys(value as Record<string, unknown>, [
      "schema_version",
      "schema_id",
      "current_version",
      "pending_transition",
    ])
  ) {
    throw new SchemaUpgradeError("invalid_state", {
      schema_id: expected_schema_id,
    });
  }

  const stored = value as Record<string, unknown>;
  if (
    stored.schema_version !== stored_state_schema_version ||
    stored.schema_id !== expected_schema_id ||
    !is_schema_upgrade_version(stored.current_version)
  ) {
    throw new SchemaUpgradeError("invalid_state", {
      schema_id: expected_schema_id,
    });
  }

  const supplied_transition = stored.pending_transition;
  let pending_transition: SchemaUpgradeTransition | null = null;
  if (supplied_transition !== null) {
    if (
      typeof supplied_transition !== "object" ||
      Array.isArray(supplied_transition) ||
      !has_exact_keys(supplied_transition as Record<string, unknown>, [
        "step_id",
        "from_version",
        "to_version",
      ])
    ) {
      throw new SchemaUpgradeError("invalid_state", {
        schema_id: expected_schema_id,
      });
    }
    const transition = supplied_transition as Record<string, unknown>;
    if (
      !is_schema_upgrade_identifier(transition.step_id) ||
      !is_schema_upgrade_version(transition.from_version) ||
      !is_schema_upgrade_version(transition.to_version) ||
      transition.from_version !== stored.current_version ||
      transition.to_version !== Number(transition.from_version) + 1
    ) {
      throw new SchemaUpgradeError("invalid_state", {
        schema_id: expected_schema_id,
      });
    }
    pending_transition = Object.freeze({
      step_id: transition.step_id,
      from_version: transition.from_version,
      to_version: transition.to_version,
    });
  }

  return Object.freeze({
    current_version: stored.current_version,
    pending_transition,
  });
}

/** Deno KV compare-and-set implementation in an adapter-owned v1 keyspace. */
export class DenoKvSchemaUpgradeStateRepository
  implements SchemaUpgradeStateRepository {
  readonly #kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.#kv = kv;
  }

  async read_state(schema_id: string): Promise<SchemaUpgradeState | null> {
    const key = deno_kv_schema_upgrade_state_key(schema_id);
    const entry = await this.#kv.get<unknown>(key);
    if (entry.versionstamp === null) return null;
    return decode_state(schema_id, entry.value);
  }

  async initialize_state(input: {
    readonly schema_id: string;
    readonly baseline_version: number;
  }): Promise<SchemaUpgradeStateMutationResult> {
    require_schema_id(input.schema_id);
    require_version(input.baseline_version);
    const key = deno_kv_schema_upgrade_state_key(input.schema_id);
    const entry = await this.#kv.get<unknown>(key);
    if (entry.versionstamp !== null) {
      decode_state(input.schema_id, entry.value);
      return "conflict";
    }
    const result = await this.#kv.atomic()
      .check(entry)
      .set(key, stored_state(input.schema_id, input.baseline_version, null))
      .commit();
    return result.ok ? "applied" : "conflict";
  }

  async claim_transition(input: {
    readonly schema_id: string;
    readonly expected_current_version: number;
    readonly transition: SchemaUpgradeTransition;
  }): Promise<SchemaUpgradeStateMutationResult> {
    require_schema_id(input.schema_id);
    require_version(input.expected_current_version);
    require_transition(input.transition, input.expected_current_version);
    const key = deno_kv_schema_upgrade_state_key(input.schema_id);
    const entry = await this.#kv.get<unknown>(key);
    if (entry.versionstamp === null) return "conflict";
    const state = decode_state(input.schema_id, entry.value);
    if (
      state.current_version !== input.expected_current_version ||
      state.pending_transition !== null
    ) {
      return "conflict";
    }

    const result = await this.#kv.atomic()
      .check(entry)
      .set(
        key,
        stored_state(
          input.schema_id,
          input.expected_current_version,
          input.transition,
        ),
      )
      .commit();
    return result.ok ? "applied" : "conflict";
  }

  async complete_transition(input: {
    readonly schema_id: string;
    readonly transition: SchemaUpgradeTransition;
  }): Promise<SchemaUpgradeStateMutationResult> {
    require_schema_id(input.schema_id);
    require_transition(input.transition);
    const key = deno_kv_schema_upgrade_state_key(input.schema_id);
    const entry = await this.#kv.get<unknown>(key);
    if (entry.versionstamp === null) return "conflict";
    const state = decode_state(input.schema_id, entry.value);
    if (
      state.current_version !== input.transition.from_version ||
      state.pending_transition === null ||
      state.pending_transition.step_id !== input.transition.step_id ||
      state.pending_transition.from_version !== input.transition.from_version ||
      state.pending_transition.to_version !== input.transition.to_version
    ) {
      return "conflict";
    }

    const result = await this.#kv.atomic()
      .check(entry)
      .set(
        key,
        stored_state(input.schema_id, input.transition.to_version, null),
      )
      .commit();
    return result.ok ? "applied" : "conflict";
  }
}
