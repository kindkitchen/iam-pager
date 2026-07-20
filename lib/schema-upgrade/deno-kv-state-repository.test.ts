import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { SchemaUpgradeError } from "./errors.ts";
import {
  deno_kv_schema_upgrade_state_key,
  DenoKvSchemaUpgradeStateRepository,
} from "./deno-kv-state-repository.ts";
import { test_schema_upgrade_state_repository_conformance } from "./state-repository-conformance.ts";
import { ForwardDatabaseSchemaUpgrader } from "./upgrader.ts";

const conformance_handles = new WeakMap<object, Deno.Kv>();

test_schema_upgrade_state_repository_conformance({
  name: "DenoKvSchemaUpgradeStateRepository",
  make_repository: async () => {
    const kv = await Deno.openKv(":memory:");
    const repository = new DenoKvSchemaUpgradeStateRepository(kv);
    conformance_handles.set(repository, kv);
    return repository;
  },
  teardown: (repository) => {
    conformance_handles.get(repository)?.close();
    conformance_handles.delete(repository);
  },
});

Deno.test("Deno KV schema state persists pending and completed progress across adapter instances", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const transition = {
      step_id: "pages-v1-to-v2",
      from_version: 1,
      to_version: 2,
    } as const;
    const writer = new DenoKvSchemaUpgradeStateRepository(kv);
    await writer.initialize_state({
      schema_id: "pages",
      baseline_version: 1,
    });
    await writer.claim_transition({
      schema_id: "pages",
      expected_current_version: 1,
      transition,
    });

    const resumer = new DenoKvSchemaUpgradeStateRepository(kv);
    assertEquals(await resumer.read_state("pages"), {
      current_version: 1,
      pending_transition: transition,
    });
    await resumer.complete_transition({ schema_id: "pages", transition });

    const next_process_adapter = new DenoKvSchemaUpgradeStateRepository(kv);
    assertEquals(await next_process_adapter.read_state("pages"), {
      current_version: 2,
      pending_transition: null,
    });
    assertEquals(
      (await kv.get(deno_kv_schema_upgrade_state_key("pages"))).value,
      {
        schema_version: 1,
        schema_id: "pages",
        current_version: 2,
        pending_transition: null,
      },
    );
  } finally {
    kv.close();
  }
});

Deno.test("Deno KV schema state rejects corrupt envelopes without exposing values", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await kv.set(deno_kv_schema_upgrade_state_key("pages"), {
      schema_version: 2,
      schema_id: "pages",
      current_version: 999,
      pending_transition: null,
      secret: "must-not-appear",
    });
    const repository = new DenoKvSchemaUpgradeStateRepository(kv);
    const error = await assertRejects(() => repository.read_state("pages"));
    assertInstanceOf(error, SchemaUpgradeError);
    assertEquals(error.code, "invalid_state");
    assertEquals(error.message.includes("must-not-appear"), false);
    assertEquals(error.message.includes("999"), false);
  } finally {
    kv.close();
  }
});

Deno.test("concurrent Deno KV runners keep one transition data mutation safe", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    let arrivals = 0;
    let first_arrival!: () => void;
    let second_arrival!: () => void;
    let release!: () => void;
    const first_arrived = new Promise<void>((resolve) =>
      first_arrival = resolve
    );
    const second_arrived = new Promise<void>((resolve) =>
      second_arrival = resolve
    );
    const released = new Promise<void>((resolve) => release = resolve);
    const marker_key: Deno.KvKey = ["test", "schema-upgrade", "marker"];
    const plan = {
      schema_id: "pages",
      baseline_version: 1,
      target_version: 2,
      steps: [{
        step_id: "pages-v1-to-v2",
        from_version: 1,
        to_version: 2,
        upgrade: async () => {
          arrivals += 1;
          if (arrivals === 1) first_arrival();
          if (arrivals === 2) second_arrival();
          await released;
          const marker = await kv.get(marker_key);
          await kv.atomic().check(marker).set(marker_key, { applications: 1 })
            .commit();
        },
      }],
    } as const;
    const first = new ForwardDatabaseSchemaUpgrader({
      state_repository: new DenoKvSchemaUpgradeStateRepository(kv),
      plans: [plan],
    });
    const second = new ForwardDatabaseSchemaUpgrader({
      state_repository: new DenoKvSchemaUpgradeStateRepository(kv),
      plans: [plan],
    });

    const first_run = first.upgrade(undefined);
    await first_arrived;
    const second_run = second.upgrade(undefined);
    await second_arrived;
    release();
    const reports = await Promise.all([first_run, second_run]);

    assertEquals(arrivals, 2);
    assertEquals((await kv.get(marker_key)).value, { applications: 1 });
    assertEquals(
      reports.map((report) => report.schemas[0].outcome).sort(),
      ["resumed", "upgraded"],
    );
    assertEquals(
      await new DenoKvSchemaUpgradeStateRepository(kv).read_state("pages"),
      { current_version: 2, pending_transition: null },
    );
  } finally {
    kv.close();
  }
});
