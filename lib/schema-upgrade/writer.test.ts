import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { SchemaUpgradeError } from "./errors.ts";
import type {
  DatabaseSchemaManifest,
  DatabaseSchemaManifestRepository,
  DatabaseSchemaWriteRequest,
  SchemaUpgradePlan,
  SchemaUpgradeState,
  SchemaUpgradeStateMutationResult,
  SchemaUpgradeStateRepository,
  SchemaUpgradeTransition,
} from "./interfaces.ts";
import { database_schema_manifests_equal } from "./manifest.ts";
import { GuardedDatabaseSchemaWriter } from "./writer.ts";

class MemoryManifestRepository implements DatabaseSchemaManifestRepository {
  manifest: DatabaseSchemaManifest | null = null;
  write_count = 0;
  conflict_next_write = false;

  read_manifest(): Promise<DatabaseSchemaManifest | null> {
    return Promise.resolve(this.manifest);
  }

  initialize_manifest(
    manifest: DatabaseSchemaManifest,
  ): Promise<SchemaUpgradeStateMutationResult> {
    if (this.conflict_next_write) {
      this.conflict_next_write = false;
      return Promise.resolve("conflict");
    }
    if (this.manifest !== null) return Promise.resolve("conflict");
    this.manifest = manifest;
    this.write_count += 1;
    return Promise.resolve("applied");
  }

  replace_manifest(input: {
    readonly expected_manifest: DatabaseSchemaManifest;
    readonly manifest: DatabaseSchemaManifest;
  }): Promise<SchemaUpgradeStateMutationResult> {
    if (this.conflict_next_write) {
      this.conflict_next_write = false;
      return Promise.resolve("conflict");
    }
    if (
      this.manifest === null ||
      !database_schema_manifests_equal(
        this.manifest,
        input.expected_manifest,
      )
    ) {
      return Promise.resolve("conflict");
    }
    this.manifest = input.manifest;
    this.write_count += 1;
    return Promise.resolve("applied");
  }
}

class MemoryStateRepository implements SchemaUpgradeStateRepository {
  readonly states = new Map<string, SchemaUpgradeState>();
  write_count = 0;

  read_state(schema_id: string): Promise<SchemaUpgradeState | null> {
    return Promise.resolve(this.states.get(schema_id) ?? null);
  }

  initialize_state(input: {
    readonly schema_id: string;
    readonly baseline_version: number;
  }): Promise<SchemaUpgradeStateMutationResult> {
    if (this.states.has(input.schema_id)) return Promise.resolve("conflict");
    this.states.set(input.schema_id, {
      current_version: input.baseline_version,
      pending_transition: null,
    });
    this.write_count += 1;
    return Promise.resolve("applied");
  }

  claim_transition(input: {
    readonly schema_id: string;
    readonly expected_current_version: number;
    readonly transition: SchemaUpgradeTransition;
  }): Promise<SchemaUpgradeStateMutationResult> {
    const state = this.states.get(input.schema_id);
    if (
      state === undefined ||
      state.current_version !== input.expected_current_version ||
      state.pending_transition !== null
    ) {
      return Promise.resolve("conflict");
    }
    this.states.set(input.schema_id, {
      current_version: state.current_version,
      pending_transition: { ...input.transition },
    });
    this.write_count += 1;
    return Promise.resolve("applied");
  }

  complete_transition(input: {
    readonly schema_id: string;
    readonly transition: SchemaUpgradeTransition;
  }): Promise<SchemaUpgradeStateMutationResult> {
    const state = this.states.get(input.schema_id);
    const pending = state?.pending_transition;
    if (
      pending === null || pending === undefined ||
      pending.step_id !== input.transition.step_id ||
      pending.from_version !== input.transition.from_version ||
      pending.to_version !== input.transition.to_version
    ) {
      return Promise.resolve("conflict");
    }
    this.states.set(input.schema_id, {
      current_version: input.transition.to_version,
      pending_transition: null,
    });
    this.write_count += 1;
    return Promise.resolve("applied");
  }
}

const current_plans: readonly SchemaUpgradePlan<undefined>[] = [
  {
    schema_id: "ownership",
    baseline_version: 1,
    target_version: 1,
    steps: [],
  },
  {
    schema_id: "pages",
    baseline_version: 1,
    target_version: 1,
    steps: [],
  },
];

function request(
  from_version: number,
  to_version: number,
  project_id = "iam-pager",
): DatabaseSchemaWriteRequest {
  return {
    project_id,
    from_versions: current_plans.map((plan) => ({
      schema_id: plan.schema_id,
      version: from_version,
    })),
    to_versions: current_plans.map((plan) => ({
      schema_id: plan.schema_id,
      version: to_version,
    })),
  };
}

Deno.test("guarded schema writer bootstraps only an explicitly unversioned database", async () => {
  const manifests = new MemoryManifestRepository();
  const states = new MemoryStateRepository();
  const writer = new GuardedDatabaseSchemaWriter({
    project_id: "iam-pager",
    manifest_repository: manifests,
    state_repository: states,
    plans: current_plans,
  });

  const report = await writer.write(request(0, 1), undefined);
  assertEquals(report.from_versions.map((version) => version.version), [0, 0]);
  assertEquals(report.to_versions.map((version) => version.version), [1, 1]);
  assertEquals(manifests.manifest, {
    project_id: "iam-pager",
    schema_versions: [
      { schema_id: "ownership", version: 1 },
      { schema_id: "pages", version: 1 },
    ],
  });
  assertEquals(states.states.get("ownership")?.current_version, 1);
  assertEquals(states.states.get("pages")?.current_version, 1);
  assertEquals(manifests.write_count, 1);
  assertEquals(states.write_count, 2);

  await writer.write(request(1, 1), undefined);
  assertEquals(manifests.write_count, 1);
  assertEquals(states.write_count, 2);
});

Deno.test("guarded schema writer performs no write on project or vector mismatch", async () => {
  const mismatch_cases: readonly {
    manifest: DatabaseSchemaManifest | null;
    request: DatabaseSchemaWriteRequest;
    code: string;
  }[] = [
    {
      manifest: {
        project_id: "other-project",
        schema_versions: [
          { schema_id: "ownership", version: 1 },
          { schema_id: "pages", version: 1 },
        ],
      },
      request: request(1, 1),
      code: "wrong_project",
    },
    {
      manifest: {
        project_id: "iam-pager",
        schema_versions: [
          { schema_id: "ownership", version: 1 },
          { schema_id: "pages", version: 1 },
        ],
      },
      request: request(0, 1),
      code: "version_mismatch",
    },
    {
      manifest: null,
      request: request(0, 2),
      code: "invalid_request",
    },
    {
      manifest: null,
      request: request(0, 1, "other-project"),
      code: "wrong_project",
    },
  ];

  for (const test_case of mismatch_cases) {
    const manifests = new MemoryManifestRepository();
    manifests.manifest = test_case.manifest;
    const states = new MemoryStateRepository();
    const writer = new GuardedDatabaseSchemaWriter({
      project_id: "iam-pager",
      manifest_repository: manifests,
      state_repository: states,
      plans: current_plans,
    });
    const error = await assertRejects(() =>
      writer.write(test_case.request, undefined)
    );
    assertInstanceOf(error, SchemaUpgradeError);
    assertEquals(error.code, test_case.code);
    assertEquals(manifests.write_count, 0);
    assertEquals(states.write_count, 0);
  }
});

Deno.test("guarded schema writer leaves old manifest stale and resumes a failed helper", async () => {
  const manifests = new MemoryManifestRepository();
  manifests.manifest = {
    project_id: "iam-pager",
    schema_versions: [{ schema_id: "pages", version: 1 }],
  };
  const states = new MemoryStateRepository();
  states.states.set("pages", {
    current_version: 1,
    pending_transition: null,
  });
  const data = new Set<string>();
  let fail_once = true;
  const plans: readonly SchemaUpgradePlan<undefined>[] = [{
    schema_id: "pages",
    baseline_version: 1,
    target_version: 2,
    steps: [{
      step_id: "pages-v1-to-v2",
      from_version: 1,
      to_version: 2,
      upgrade: () => {
        data.add("updated");
        if (fail_once) {
          fail_once = false;
          throw new Error("interrupted");
        }
      },
    }],
  }];
  const writer = new GuardedDatabaseSchemaWriter({
    project_id: "iam-pager",
    manifest_repository: manifests,
    state_repository: states,
    plans,
  });
  const migration_request = {
    project_id: "iam-pager",
    from_versions: [{ schema_id: "pages", version: 1 }],
    to_versions: [{ schema_id: "pages", version: 2 }],
  } as const;

  const failure = await assertRejects(() =>
    writer.write(migration_request, undefined)
  );
  assertInstanceOf(failure, SchemaUpgradeError);
  assertEquals(failure.code, "step_failed");
  assertEquals(manifests.manifest?.schema_versions[0].version, 1);
  assertEquals(
    states.states.get("pages")?.pending_transition?.step_id,
    "pages-v1-to-v2",
  );

  const report = await writer.write(migration_request, undefined);
  assertEquals(report.upgrade.schemas[0].outcome, "resumed");
  assertEquals(data, new Set(["updated"]));
  assertEquals(manifests.manifest?.schema_versions[0].version, 2);
  assertEquals(states.states.get("pages")?.current_version, 2);
});

Deno.test("guarded schema writer never publishes a manifest after a CAS conflict", async () => {
  const manifests = new MemoryManifestRepository();
  manifests.manifest = {
    project_id: "iam-pager",
    schema_versions: [{ schema_id: "pages", version: 1 }],
  };
  manifests.conflict_next_write = true;
  const states = new MemoryStateRepository();
  states.states.set("pages", {
    current_version: 1,
    pending_transition: null,
  });
  const plans: readonly SchemaUpgradePlan<undefined>[] = [{
    schema_id: "pages",
    baseline_version: 1,
    target_version: 2,
    steps: [{
      step_id: "pages-v1-to-v2",
      from_version: 1,
      to_version: 2,
      upgrade: () => undefined,
    }],
  }];
  const writer = new GuardedDatabaseSchemaWriter({
    project_id: "iam-pager",
    manifest_repository: manifests,
    state_repository: states,
    plans,
  });

  const error = await assertRejects(() =>
    writer.write({
      project_id: "iam-pager",
      from_versions: [{ schema_id: "pages", version: 1 }],
      to_versions: [{ schema_id: "pages", version: 2 }],
    }, undefined)
  );
  assertInstanceOf(error, SchemaUpgradeError);
  assertEquals(error.code, "manifest_conflict");
  assertEquals(manifests.manifest?.schema_versions[0].version, 1);
  assertEquals(states.states.get("pages")?.current_version, 2);
});
