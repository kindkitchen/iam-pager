import { assertEquals } from "@std/assert";
import type {
  DatabaseSchemaManifest,
  DatabaseSchemaManifestRepository,
  SchemaUpgradePlan,
  SchemaUpgradeState,
  SchemaUpgradeStateMutationResult,
  SchemaUpgradeStateRepository,
  SchemaUpgradeTransition,
} from "./interfaces.ts";
import { ExactDatabaseSchemaVersionChecker } from "./checker.ts";

class MemoryManifestRepository implements DatabaseSchemaManifestRepository {
  manifest: DatabaseSchemaManifest | null = null;
  write_count = 0;

  read_manifest(): Promise<DatabaseSchemaManifest | null> {
    return Promise.resolve(this.manifest);
  }

  initialize_manifest(
    manifest: DatabaseSchemaManifest,
  ): Promise<SchemaUpgradeStateMutationResult> {
    this.write_count += 1;
    this.manifest = manifest;
    return Promise.resolve("applied");
  }

  replace_manifest(input: {
    readonly expected_manifest: DatabaseSchemaManifest;
    readonly manifest: DatabaseSchemaManifest;
  }): Promise<SchemaUpgradeStateMutationResult> {
    this.write_count += 1;
    this.manifest = input.manifest;
    return Promise.resolve("applied");
  }
}

class MemoryStateRepository implements SchemaUpgradeStateRepository {
  readonly states = new Map<string, SchemaUpgradeState>();
  read_count = 0;
  write_count = 0;

  read_state(schema_id: string): Promise<SchemaUpgradeState | null> {
    this.read_count += 1;
    return Promise.resolve(this.states.get(schema_id) ?? null);
  }

  initialize_state(): Promise<SchemaUpgradeStateMutationResult> {
    this.write_count += 1;
    return Promise.resolve("applied");
  }

  claim_transition(_input: {
    readonly schema_id: string;
    readonly expected_current_version: number;
    readonly transition: SchemaUpgradeTransition;
  }): Promise<SchemaUpgradeStateMutationResult> {
    this.write_count += 1;
    return Promise.resolve("applied");
  }

  complete_transition(): Promise<SchemaUpgradeStateMutationResult> {
    this.write_count += 1;
    return Promise.resolve("applied");
  }
}

const plans: readonly SchemaUpgradePlan<undefined>[] = [
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

function current_states(repository: MemoryStateRepository): void {
  for (const plan of plans) {
    repository.states.set(plan.schema_id, {
      current_version: 1,
      pending_transition: null,
    });
  }
}

Deno.test("database schema checker reports absent manifest as version zero without writes", async () => {
  const manifests = new MemoryManifestRepository();
  const states = new MemoryStateRepository();
  const checker = new ExactDatabaseSchemaVersionChecker({
    project_id: "iam-pager",
    manifest_repository: manifests,
    state_repository: states,
    plans,
  });

  assertEquals(await checker.check(), {
    project_id: "iam-pager",
    outcome: "unversioned",
    schemas: [
      {
        schema_id: "ownership",
        version: 0,
        target_version: 1,
        outcome: "unversioned",
      },
      {
        schema_id: "pages",
        version: 0,
        target_version: 1,
        outcome: "unversioned",
      },
    ],
  });
  assertEquals(states.read_count, 0);
  assertEquals(manifests.write_count, 0);
  assertEquals(states.write_count, 0);
});

Deno.test("database schema checker accepts only exact project, manifest, and state", async () => {
  const manifests = new MemoryManifestRepository();
  manifests.manifest = {
    project_id: "iam-pager",
    schema_versions: [
      { schema_id: "ownership", version: 1 },
      { schema_id: "pages", version: 1 },
    ],
  };
  const states = new MemoryStateRepository();
  current_states(states);
  const checker = new ExactDatabaseSchemaVersionChecker({
    project_id: "iam-pager",
    manifest_repository: manifests,
    state_repository: states,
    plans,
  });

  const report = await checker.check();
  assertEquals(report.outcome, "current");
  assertEquals(report.schemas.map((schema) => schema.outcome), [
    "current",
    "current",
  ]);
  assertEquals(manifests.write_count, 0);
  assertEquals(states.write_count, 0);
});

Deno.test("database schema checker rejects another project before schema reads", async () => {
  const manifests = new MemoryManifestRepository();
  manifests.manifest = {
    project_id: "other-project",
    schema_versions: [{ schema_id: "pages", version: 1 }],
  };
  const states = new MemoryStateRepository();
  const checker = new ExactDatabaseSchemaVersionChecker({
    project_id: "iam-pager",
    manifest_repository: manifests,
    state_repository: states,
    plans,
  });

  assertEquals(await checker.check(), {
    project_id: "iam-pager",
    outcome: "wrong_project",
    schemas: [],
  });
  assertEquals(states.read_count, 0);
  assertEquals(manifests.write_count, 0);
});

Deno.test("database schema checker distinguishes stale, pending, and future state", async () => {
  const cases: readonly {
    manifest: DatabaseSchemaManifest;
    mutate: (states: MemoryStateRepository) => void;
    outcome: string;
  }[] = [
    {
      manifest: {
        project_id: "iam-pager",
        schema_versions: [{ schema_id: "ownership", version: 1 }],
      },
      mutate: current_states,
      outcome: "stale",
    },
    {
      manifest: {
        project_id: "iam-pager",
        schema_versions: [
          { schema_id: "ownership", version: 1 },
          { schema_id: "pages", version: 1 },
        ],
      },
      mutate: (states) => {
        current_states(states);
        states.states.set("pages", {
          current_version: 1,
          pending_transition: {
            step_id: "pages-v1-to-v2",
            from_version: 1,
            to_version: 2,
          },
        });
      },
      outcome: "pending",
    },
    {
      manifest: {
        project_id: "iam-pager",
        schema_versions: [
          { schema_id: "ownership", version: 1 },
          { schema_id: "pages", version: 2 },
        ],
      },
      mutate: current_states,
      outcome: "future",
    },
    {
      manifest: {
        project_id: "iam-pager",
        schema_versions: [
          { schema_id: "ownership", version: 1 },
          { schema_id: "pages", version: 1 },
          { schema_id: "retired", version: 1 },
        ],
      },
      mutate: current_states,
      outcome: "future",
    },
  ];

  for (const test_case of cases) {
    const manifests = new MemoryManifestRepository();
    manifests.manifest = test_case.manifest;
    const states = new MemoryStateRepository();
    test_case.mutate(states);
    const checker = new ExactDatabaseSchemaVersionChecker({
      project_id: "iam-pager",
      manifest_repository: manifests,
      state_repository: states,
      plans,
    });
    assertEquals((await checker.check()).outcome, test_case.outcome);
    assertEquals(manifests.write_count, 0);
    assertEquals(states.write_count, 0);
  }
});
