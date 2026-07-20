import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { make_page_content } from "../page/repository-conformance.ts";
import { DenoKvPageRepository } from "../page/kv-repository.ts";
import type { PageRecord } from "../page/model.ts";
import type { KvGateway } from "./kv-gateway.ts";
import {
  content_asset_manifest_key,
  content_asset_payload_key,
} from "./kv-content-asset-repository.ts";
import { KvPageAggregateRepository } from "./kv-page-aggregate-repository.ts";
import { KvToolboxGateway } from "./kv-toolbox-gateway.ts";
import {
  KvPagesV1ToV2MigrationSource,
  KvPagesV2ReadinessProbe,
  map_page_v1_to_v2,
  migrate_pages_v1_to_v2,
  pages_v1_to_v2_readiness_key,
} from "./pages-v1-to-v2-migration.ts";

const t1 = new Date("2026-07-20T14:00:00.000Z");
const t2 = new Date("2026-07-20T15:00:00.000Z");

function gateway(kv: Deno.Kv): KvToolboxGateway {
  return new KvToolboxGateway(kv);
}

async function list_entries(
  kv: Deno.Kv,
  prefix: Deno.KvKey,
): Promise<Deno.KvEntry<unknown>[]> {
  return await Array.fromAsync(kv.list<unknown>({ prefix }));
}

async function capture_entries(
  kv: Deno.Kv,
  prefix: Deno.KvKey,
): Promise<
  readonly {
    readonly key: Deno.KvKey;
    readonly value: unknown;
    readonly versionstamp: string;
  }[]
> {
  return (await list_entries(kv, prefix)).map((entry) => ({
    key: structuredClone(entry.key),
    value: structuredClone(entry.value),
    versionstamp: entry.versionstamp,
  }));
}

async function seed_trial(kv: Deno.Kv): Promise<PageRecord> {
  const repository = new DenoKvPageRepository(gateway(kv));
  const result = await repository.put_trial({
    page_id: "trial-1",
    locator: { namespace: "Guest" },
    content: make_page_content("trial"),
    now: t1,
  });
  assert(result.ok);
  return result.page;
}

async function seed_mixed_pages(kv: Deno.Kv): Promise<readonly PageRecord[]> {
  const repository = new DenoKvPageRepository(gateway(kv));
  const trial = await repository.put_trial({
    page_id: "trial-1",
    locator: { namespace: "Guest" },
    content: make_page_content("trial"),
    now: t1,
  });
  assert(trial.ok);
  const public_page = await repository.create_managed({
    page_id: "managed-public",
    locator: { namespace: "Alice", page_name: "Public" },
    owner_user_id: "owner-1",
    access: "public",
    tags: ["guide", "public"],
    content: make_page_content("public"),
    now: t1,
  });
  assert(public_page.ok);
  const private_page = await repository.create_managed({
    page_id: "managed-private",
    locator: { namespace: "Alice", page_name: "Private" },
    owner_user_id: "owner-1",
    access: "private",
    tags: ["private"],
    content: make_page_content("private-v1"),
    now: t1,
  });
  assert(private_page.ok);
  const replaced = await repository.replace_managed({
    page_id: private_page.page.page_id,
    owner_user_id: "owner-1",
    expected_revision: private_page.page.revision,
    access: "private",
    tags: ["private", "revised"],
    content: make_page_content("private-v2"),
    now: t2,
  });
  assert(replaced.ok);
  return [trial.page, public_page.page, replaced.page].sort((left, right) =>
    left.page_id.localeCompare(right.page_id)
  );
}

function with_observed_native_commit(
  supplied_gateway: KvGateway,
  observe: (
    commit: number,
    result: Readonly<{ ok: boolean }>,
  ) => void | Promise<void>,
): KvGateway {
  let commits = 0;
  return new Proxy(supplied_gateway, {
    get(target, property) {
      if (property === "native_atomic") {
        return () => {
          const operation = target.native_atomic();
          const proxy: Deno.AtomicOperation = new Proxy(operation, {
            get(operation_target, operation_property) {
              if (operation_property === "commit") {
                return async () => {
                  commits += 1;
                  const result = await operation_target.commit();
                  await observe(commits, result);
                  return result;
                };
              }
              const value = Reflect.get(operation_target, operation_property);
              if (typeof value !== "function") return value;
              return (...args: unknown[]) => {
                const result = Reflect.apply(value, operation_target, args);
                return result === operation_target ? proxy : result;
              };
            },
          });
          return proxy;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function with_interrupted_native_commit(
  supplied_gateway: KvGateway,
  target_commit: number,
  timing: "before" | "after",
): KvGateway {
  let commits = 0;
  if (timing === "after") {
    return with_observed_native_commit(supplied_gateway, (commit) => {
      if (commit === target_commit) {
        throw new Error("injected migration interruption");
      }
    });
  }
  return new Proxy(supplied_gateway, {
    get(target, property) {
      if (property === "native_atomic") {
        return () => {
          const operation = target.native_atomic();
          const proxy: Deno.AtomicOperation = new Proxy(operation, {
            get(operation_target, operation_property) {
              if (operation_property === "commit") {
                return async () => {
                  commits += 1;
                  if (commits === target_commit) {
                    throw new Error("injected migration interruption");
                  }
                  return await operation_target.commit();
                };
              }
              const value = Reflect.get(operation_target, operation_property);
              if (typeof value !== "function") return value;
              return (...args: unknown[]) => {
                const result = Reflect.apply(value, operation_target, args);
                return result === operation_target ? proxy : result;
              };
            },
          });
          return proxy;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

Deno.test("pages-v1-to-v2 migrates an empty baseline and reruns without writes", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await migrate_pages_v1_to_v2(gateway(kv));
    assertEquals(
      (await kv.get<Record<string, unknown>>(pages_v1_to_v2_readiness_key))
        .value?.source_page_count,
      0,
    );
    await new KvPagesV2ReadinessProbe(gateway(kv)).assert_ready();

    const before = await capture_entries(kv, ["iam-pager"]);
    await migrate_pages_v1_to_v2(gateway(kv));
    assertEquals(await capture_entries(kv, ["iam-pager"]), before);
  } finally {
    kv.close();
  }
});

Deno.test("pages-v1-to-v2 preserves mixed source records and projects exact assets and aggregates", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const source_pages = await seed_mixed_pages(kv);
    const trial_key = ["iam-pager", "pages", "by-id", "trial-1"];
    const trial_envelope = (await kv.get<Record<string, unknown>>(trial_key))
      .value!;
    const { tags: _legacy_tags, ...pre_tag_envelope } = trial_envelope;
    await kv.set(trial_key, pre_tag_envelope);
    const source_before = await capture_entries(kv, ["iam-pager", "pages"]);
    await migrate_pages_v1_to_v2(gateway(kv));

    const aggregate_repository = new KvPageAggregateRepository(gateway(kv));
    const mapped_pages = await Promise.all(
      source_pages.map(map_page_v1_to_v2),
    );
    for (const mapped of mapped_pages) {
      assertEquals(
        await aggregate_repository.find_page_aggregate_by_id(
          mapped.aggregate.page_id,
        ),
        mapped.aggregate,
      );
      assertEquals(
        await aggregate_repository.find_content_asset_by_id(
          mapped.asset.content_asset_id,
        ),
        mapped.asset,
      );
      assertStringIncludes(mapped.asset.content_asset_id, "v1a_");
      assertStringIncludes(mapped.payload_id, "v1p_");
      assertEquals(
        (await aggregate_repository.resolve_page_endpoint(
          mapped.aggregate.endpoint_set.canonical.locator,
        ))?.endpoint.delivery_profile,
        "inline",
      );
    }

    const managed = await aggregate_repository.list_managed_page_aggregates({
      owner_user_id: "owner-1",
      limit: 10,
    });
    assert(managed.ok);
    assertEquals(managed.pages.map((page) => page.page_id), [
      "managed-private",
      "managed-public",
    ]);
    const public_pages = await aggregate_repository
      .list_public_page_aggregates({ namespace: "ALICE", limit: 10 });
    assert(public_pages.ok);
    assertEquals(
      public_pages.pages.map((page) => page.page_id),
      ["managed-public"],
    );
    assertEquals(
      await capture_entries(kv, ["iam-pager", "pages"]),
      source_before,
    );
    await new KvPagesV2ReadinessProbe(gateway(kv)).assert_ready();

    const all_before_rerun = await capture_entries(kv, ["iam-pager"]);
    await migrate_pages_v1_to_v2(gateway(kv));
    assertEquals(
      await capture_entries(kv, ["iam-pager"]),
      all_before_rerun,
    );
  } finally {
    kv.close();
  }
});

Deno.test("pages-v1-to-v2 retries deterministic payload, aggregate, and readiness interruptions", async () => {
  const interruptions = [
    { target_commit: 1, timing: "before" as const },
    { target_commit: 2, timing: "after" as const },
    { target_commit: 3, timing: "after" as const },
  ];
  for (const interruption of interruptions) {
    const kv = await Deno.openKv(":memory:");
    try {
      const source_page = await seed_trial(kv);
      const mapped = await map_page_v1_to_v2(source_page);
      await assertRejects(
        () =>
          migrate_pages_v1_to_v2(
            with_interrupted_native_commit(
              gateway(kv),
              interruption.target_commit,
              interruption.timing,
            ),
          ),
        Error,
        "injected migration interruption",
      );
      if (interruption.target_commit === 1) {
        assertEquals(
          (await kv.get(content_asset_manifest_key(
            mapped.asset.content_asset_id,
          ))).value,
          null,
        );
        assert(
          await gateway(kv).get_binary_object_metadata(
            content_asset_payload_key(mapped.payload_id),
          ) !== null,
        );
      }

      await migrate_pages_v1_to_v2(gateway(kv));
      await new KvPagesV2ReadinessProbe(gateway(kv)).assert_ready();
      assertEquals(
        await new KvPageAggregateRepository(gateway(kv))
          .find_page_aggregate_by_id(source_page.page_id),
        mapped.aggregate,
      );
    } finally {
      kv.close();
    }
  }
});

Deno.test("pages-v1-to-v2 rejects a source write racing readiness publication", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const source_page = await seed_trial(kv);
    const source_repository = new DenoKvPageRepository(gateway(kv));
    const observed = with_observed_native_commit(
      gateway(kv),
      async (commit, result) => {
        if (commit !== 3 || !result.ok) return;
        const replaced = await source_repository.put_trial({
          page_id: "ignored-new-id",
          locator: source_page.locator,
          content: make_page_content("changed-at-readiness"),
          now: t2,
        });
        assert(replaced.ok);
      },
    );

    await assertRejects(
      () => migrate_pages_v1_to_v2(observed),
      Error,
      "schema-v1 source changed after readiness publication",
    );
    await assertRejects(
      () => new KvPagesV2ReadinessProbe(gateway(kv)).assert_ready(),
      Error,
      "schema-v1 storage changed after migration",
    );
  } finally {
    kv.close();
  }
});

Deno.test("pages-v1-to-v2 tolerates concurrent identical migration attempts", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await seed_mixed_pages(kv);
    const source_before = await capture_entries(kv, ["iam-pager", "pages"]);
    await Promise.all([
      migrate_pages_v1_to_v2(gateway(kv)),
      migrate_pages_v1_to_v2(gateway(kv)),
    ]);
    await new KvPagesV2ReadinessProbe(gateway(kv)).assert_ready();
    assertEquals(
      await capture_entries(kv, ["iam-pager", "pages"]),
      source_before,
    );
  } finally {
    kv.close();
  }
});

Deno.test("pages-v1-to-v2 rejects corrupt envelope, index, and chunk fixtures", async () => {
  const corruptions: readonly ((kv: Deno.Kv) => Promise<void>)[] = [
    async (kv) => {
      const key = ["iam-pager", "pages", "by-id", "trial-1"];
      const envelope = (await kv.get<Record<string, unknown>>(key)).value!;
      await kv.set(key, { ...envelope, schema_version: 9 });
    },
    async (kv) => {
      await kv.delete([
        "iam-pager",
        "pages",
        "by-locator",
        "guest",
        0,
        "",
      ]);
    },
    async (kv) => {
      const envelope = (await kv.get<{ generation: string }>([
        "iam-pager",
        "pages",
        "by-id",
        "trial-1",
      ])).value!;
      await kv.delete([
        "iam-pager",
        "pages",
        "chunks",
        "trial-1",
        envelope.generation,
        0,
      ]);
    },
  ];

  for (const corrupt of corruptions) {
    const kv = await Deno.openKv(":memory:");
    try {
      await seed_trial(kv);
      await corrupt(kv);
      await assertRejects(
        () => migrate_pages_v1_to_v2(gateway(kv)),
        Error,
      );
      assertEquals((await kv.get(pages_v1_to_v2_readiness_key)).value, null);
    } finally {
      kv.close();
    }
  }
});

Deno.test("pages-v1-to-v2 detects conflicting destination data without overwriting it", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const source_page = await seed_trial(kv);
    const destination = new KvPageAggregateRepository(gateway(kv));
    const asset = await destination.create_content_asset({
      content_asset_id: "conflicting-asset",
      content_type: "md-page",
      data: { value: "conflict" },
      meta: { media_type: "text/html", size_bytes: 8 },
      created_at: t1,
    });
    assert(asset.ok);
    const conflicting = await destination.put_trial_page_aggregate({
      page_id: source_page.page_id,
      endpoint_set: {
        canonical: {
          locator: { namespace: "Other" },
          delivery_profile: "inline",
        },
        alternates: [],
      },
      content_asset_id: asset.asset.content_asset_id,
      now: t1,
    });
    assert(conflicting.ok);
    const conflicting_before = await destination.find_page_aggregate_by_id(
      source_page.page_id,
    );

    await assertRejects(
      () => migrate_pages_v1_to_v2(gateway(kv)),
      Error,
      "destination page differs",
    );
    assertEquals(
      await destination.find_page_aggregate_by_id(source_page.page_id),
      conflicting_before,
    );
    assertEquals((await kv.get(pages_v1_to_v2_readiness_key)).value, null);
  } finally {
    kv.close();
  }
});

Deno.test("pages-v2 readiness refuses unmigrated, changed, and missing-manifest state", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvPageRepository(gateway(kv));
    const source_page = await seed_trial(kv);
    await assertRejects(
      () => new KvPagesV2ReadinessProbe(gateway(kv)).assert_ready(),
      Error,
      "non-empty schema-v1 storage is unmigrated",
    );

    await migrate_pages_v1_to_v2(gateway(kv));
    const mapped = await map_page_v1_to_v2(source_page);
    await kv.delete(content_asset_manifest_key(mapped.asset.content_asset_id));
    await assertRejects(
      () => new KvPagesV2ReadinessProbe(gateway(kv)).assert_ready(),
      Error,
      "migrated v2 storage is incomplete",
    );
    await migrate_pages_v1_to_v2(gateway(kv));
    await new KvPagesV2ReadinessProbe(gateway(kv)).assert_ready();

    const replaced = await repository.put_trial({
      page_id: "ignored-new-id",
      locator: source_page.locator,
      content: make_page_content("changed-after-migration"),
      now: t2,
    });
    assert(replaced.ok);
    await assertRejects(
      () => new KvPagesV2ReadinessProbe(gateway(kv)).assert_ready(),
      Error,
      "schema-v1 storage changed after migration",
    );
    await assertRejects(
      () => migrate_pages_v1_to_v2(gateway(kv)),
      Error,
      "destination page differs",
    );
  } finally {
    kv.close();
  }
});

Deno.test("schema-v1 migration source rejects orphan owner indexes", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await seed_trial(kv);
    await kv.set(
      ["iam-pager", "pages", "by-owner", "owner", "guest", 0, "", "ghost"],
      { schema_version: 1, page_id: "ghost", revision: 1 },
    );
    await assertRejects(
      () => new KvPagesV1ToV2MigrationSource(gateway(kv)).read_pages(),
      Error,
      "unexpected or malformed owner index",
    );
  } finally {
    kv.close();
  }
});
