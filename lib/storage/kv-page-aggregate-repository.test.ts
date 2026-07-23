import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ContentAsset } from "../content/asset.ts";
import {
  make_content_asset,
  test_page_aggregate_repository_conformance,
} from "../page/aggregate-repository-conformance.ts";
import type { PageAggregateRepository } from "../page/aggregate-interfaces.ts";
import type { PageEndpointBinding, PageEndpointSet } from "../page/endpoint.ts";
import type { KvGateway } from "./kv-gateway.ts";
import { content_asset_manifest_key } from "./kv-content-asset-repository.ts";
import {
  KvPageAggregateRepository,
  max_kv_page_endpoints,
  max_page_aggregate_atomic_checks,
  page_aggregate_atomic_check_headroom,
  page_aggregate_by_id_prefix,
  page_aggregate_max_attempts,
  page_aggregate_owner_prefix,
  page_aggregate_public_prefix,
  page_aggregate_storage_prefix,
  page_endpoint_claim_prefix,
} from "./kv-page-aggregate-repository.ts";
import { KvToolboxGateway } from "./kv-toolbox-gateway.ts";

const conformance_handles = new WeakMap<object, Deno.Kv>();

test_page_aggregate_repository_conformance({
  name: "KvPageAggregateRepository",
  make_subject: async () => {
    const kv = await Deno.openKv(":memory:");
    const repository = new KvPageAggregateRepository(new KvToolboxGateway(kv));
    conformance_handles.set(repository, kv);
    return repository;
  },
  teardown: (repository) => {
    conformance_handles.get(repository)?.close();
    conformance_handles.delete(repository);
  },
});

const t1 = new Date("2026-07-20T12:00:00.000Z");
const t2 = new Date("2026-07-20T13:00:00.000Z");

function binding(
  page_name: string,
  delivery_profile: "inline" | "attachment" = "inline",
): PageEndpointBinding {
  return {
    locator: { namespace: "Alice", page_name },
    delivery_profile,
  };
}

function endpoint_set(
  canonical_name: string,
  alternates: readonly PageEndpointBinding[] = [],
): PageEndpointSet {
  return { canonical: binding(canonical_name), alternates };
}

function eight_endpoint_set(prefix: string): PageEndpointSet {
  return endpoint_set(
    `${prefix}-0`,
    Array.from(
      { length: 7 },
      (_, index) => binding(`${prefix}-${index + 1}`, "attachment"),
    ),
  );
}

async function create_asset(
  repository: PageAggregateRepository,
  content_asset_id: string,
): Promise<ContentAsset> {
  const asset = make_content_asset(content_asset_id, content_asset_id, t1);
  const created = await repository.create_content_asset(asset);
  assert(created.ok);
  return created.asset;
}

async function list_entries(
  kv: Deno.Kv,
  prefix: Deno.KvKey,
): Promise<Deno.KvEntry<unknown>[]> {
  return await Array.fromAsync(kv.list<unknown>({ prefix }));
}

function with_rejected_native_commits(
  gateway: KvGateway,
  rejected_commit_count: number,
): KvGateway {
  let commits = 0;
  return new Proxy(gateway, {
    get(target, property) {
      if (property === "native_atomic") {
        return () => {
          const operation = target.native_atomic();
          const proxy: Deno.AtomicOperation = new Proxy(operation, {
            get(operation_target, operation_property) {
              if (operation_property === "commit") {
                return () => {
                  commits += 1;
                  if (commits <= rejected_commit_count) {
                    return Promise.resolve({ ok: false as const });
                  }
                  return operation_target.commit();
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

function with_atomic_check_counter(
  gateway: KvGateway,
  observed: number[],
): KvGateway {
  return new Proxy(gateway, {
    get(target, property) {
      if (property === "native_atomic") {
        return () => {
          const operation = target.native_atomic();
          let check_count = 0;
          const proxy: Deno.AtomicOperation = new Proxy(operation, {
            get(operation_target, operation_property) {
              if (operation_property === "check") {
                return (...args: unknown[]) => {
                  check_count += 1;
                  Reflect.apply(
                    operation_target.check,
                    operation_target,
                    args,
                  );
                  return proxy;
                };
              }
              if (operation_property === "commit") {
                return async () => {
                  observed.push(check_count);
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

Deno.test("KV page alias addition survives repository reconstruction with its asset", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const writer = new KvPageAggregateRepository(new KvToolboxGateway(kv));
    const asset = await create_asset(writer, "asset-1");
    const created = await writer.create_managed_page_aggregate({
      page_id: "page-1",
      endpoint_set: endpoint_set("Preview"),
      owner_user_id: "owner-1",
      access: "public",
      tags: ["reference"],
      content_asset_id: "asset-1",
      now: t1,
    });
    assert(created.ok);
    const updated = await writer.update_managed_page_aggregate({
      page_id: "page-1",
      owner_user_id: "owner-1",
      expected_revision: 1,
      patch: {
        endpoint_set: endpoint_set("Preview", [
          binding("Download", "attachment"),
        ]),
      },
      now: t2,
    });
    assert(updated.ok);
    assertEquals(updated.page.content_asset_id, asset.content_asset_id);

    const reader = new KvPageAggregateRepository(new KvToolboxGateway(kv));
    assertEquals(
      await reader.find_page_aggregate_by_id("page-1"),
      updated.page,
    );
    assertEquals(
      (await reader.resolve_page_endpoint({
        namespace: "ALICE",
        page_name: "download",
      }))?.page,
      updated.page,
    );
    assertEquals(
      await reader.find_content_asset_by_id(asset.content_asset_id),
      asset,
    );

    assertEquals(
      (await list_entries(kv, page_aggregate_by_id_prefix)).length,
      1,
    );
    assertEquals(
      (await list_entries(kv, page_endpoint_claim_prefix)).length,
      2,
    );
    assertEquals(
      (await list_entries(kv, page_aggregate_owner_prefix)).length,
      1,
    );
    assertEquals(
      (await list_entries(kv, page_aggregate_public_prefix)).length,
      1,
    );
  } finally {
    kv.close();
  }
});

Deno.test("KV page aggregates fail closed on malformed envelopes and index drift", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new KvPageAggregateRepository(new KvToolboxGateway(kv));
    await create_asset(repository, "asset-1");
    const created = await repository.create_managed_page_aggregate({
      page_id: "page-1",
      endpoint_set: endpoint_set("preview"),
      owner_user_id: "owner-1",
      access: "public",
      content_asset_id: "asset-1",
      now: t1,
    });
    assert(created.ok);
    const envelope_key = [...page_aggregate_by_id_prefix, "page-1"];
    const envelope = (await kv.get<Record<string, unknown>>(envelope_key))
      .value!;
    await kv.set(envelope_key, { ...envelope, revision: 0 });
    await assertRejects(
      () => repository.find_page_aggregate_by_id("page-1"),
      TypeError,
      "invalid stored page aggregate",
    );

    await kv.set(envelope_key, envelope);
    const endpoint_key = [
      ...page_endpoint_claim_prefix,
      "alice",
      1,
      "preview",
    ];
    await kv.set(endpoint_key, { page_id: "other-page", revision: 1 });
    await assertRejects(
      () => repository.find_page_aggregate_by_id("page-1"),
      Error,
      "invariant violated",
    );
  } finally {
    kv.close();
  }
});

Deno.test("KV page aggregate publication requires an intact asset manifest", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new KvPageAggregateRepository(new KvToolboxGateway(kv));
    await create_asset(repository, "asset-1");
    const manifest_key = content_asset_manifest_key("asset-1");
    const manifest = (await kv.get<Record<string, unknown>>(manifest_key))
      .value!;
    await kv.set(manifest_key, { ...manifest, data_encoding: "unknown" });
    await assertRejects(
      () =>
        repository.create_managed_page_aggregate({
          page_id: "page-1",
          endpoint_set: endpoint_set("preview"),
          owner_user_id: "owner-1",
          access: "public",
          content_asset_id: "asset-1",
          now: t1,
        }),
      TypeError,
      "invalid stored content asset",
    );
    assertEquals(await list_entries(kv, page_aggregate_storage_prefix), []);
  } finally {
    kv.close();
  }
});

Deno.test("KV page aggregate writes retry rejected native commits and bound exhaustion", async () => {
  const retry_kv = await Deno.openKv(":memory:");
  try {
    await create_asset(
      new KvPageAggregateRepository(new KvToolboxGateway(retry_kv)),
      "asset-retry",
    );
    const repository = new KvPageAggregateRepository(
      with_rejected_native_commits(
        new KvToolboxGateway(retry_kv),
        1,
      ),
    );
    const created = await repository.create_managed_page_aggregate({
      page_id: "page-retry",
      endpoint_set: endpoint_set("retry"),
      owner_user_id: "owner-1",
      access: "private",
      content_asset_id: "asset-retry",
      now: t1,
    });
    assert(created.ok);
    assertEquals(created.page.page_id, "page-retry");
  } finally {
    retry_kv.close();
  }

  const exhausted_kv = await Deno.openKv(":memory:");
  try {
    await create_asset(
      new KvPageAggregateRepository(new KvToolboxGateway(exhausted_kv)),
      "asset-exhausted",
    );
    const repository = new KvPageAggregateRepository(
      with_rejected_native_commits(
        new KvToolboxGateway(exhausted_kv),
        page_aggregate_max_attempts,
      ),
    );
    await assertRejects(
      () =>
        repository.put_trial_page_aggregate({
          page_id: "page-exhausted",
          endpoint_set: endpoint_set("exhausted"),
          content_asset_id: "asset-exhausted",
          now: t1,
        }),
      Error,
      "write contention exhausted retries",
    );
    assertEquals(
      await list_entries(exhausted_kv, page_aggregate_storage_prefix),
      [],
    );
  } finally {
    exhausted_kv.close();
  }
});

Deno.test("KV reports its locator-set capacity without changing domain validity", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new KvPageAggregateRepository(new KvToolboxGateway(kv));
    await create_asset(repository, "asset-1");
    const endpoint_set_over_capacity = endpoint_set(
      "page-0",
      Array.from(
        { length: max_kv_page_endpoints },
        (_, index) => binding(`page-${index + 1}`),
      ),
    );
    assertEquals(
      await repository.create_managed_page_aggregate({
        page_id: "page-1",
        endpoint_set: endpoint_set_over_capacity,
        owner_user_id: "owner-1",
        access: "public",
        content_asset_id: "asset-1",
        now: t1,
      }),
      { ok: false, reason: "endpoint_capacity_exceeded" },
    );
    assertEquals(await repository.find_page_aggregate_by_id("page-1"), null);
  } finally {
    kv.close();
  }
});

Deno.test("eight-endpoint worst-case duplication retains native-check headroom", async () => {
  const kv = await Deno.openKv(":memory:");
  const observed_checks: number[] = [];
  try {
    const repository = new KvPageAggregateRepository(
      with_atomic_check_counter(new KvToolboxGateway(kv), observed_checks),
    );
    await create_asset(repository, "source-asset");
    const source = await repository.create_managed_page_aggregate({
      page_id: "source",
      endpoint_set: eight_endpoint_set("source"),
      owner_user_id: "owner-1",
      access: "public",
      content_asset_id: "source-asset",
      now: t1,
    });
    assert(source.ok);

    for (let index = 0; index < 8; index += 1) {
      const asset_id = `trial-asset-${index}`;
      await create_asset(repository, asset_id);
      const alternates = Array.from(
        { length: 7 },
        (_, alternate_index) =>
          binding(`trial-${index}-extra-${alternate_index}`, "attachment"),
      );
      const trial = await repository.put_trial_page_aggregate({
        page_id: `trial-${index}`,
        endpoint_set: endpoint_set(`target-${index}`, alternates),
        content_asset_id: asset_id,
        now: t1,
      });
      assert(trial.ok);
    }

    const before_duplicate = observed_checks.length;
    const duplicated = await repository.duplicate_managed_page_aggregate({
      source_page_id: "source",
      owner_user_id: "owner-1",
      expected_revision: 1,
      page_id: "copy",
      endpoint_set: endpoint_set(
        "target-0",
        Array.from(
          { length: 7 },
          (_, index) => binding(`target-${index + 1}`, "attachment"),
        ),
      ),
      now: t2,
    });
    assert(duplicated.ok);
    const duplicate_checks = observed_checks.slice(before_duplicate);
    assertEquals(duplicate_checks, [max_page_aggregate_atomic_checks]);
    assertEquals(page_aggregate_atomic_check_headroom, 13);
    for (let index = 0; index < 8; index += 1) {
      assertEquals(
        await repository.find_page_aggregate_by_id(`trial-${index}`),
        null,
      );
      assertEquals(
        (await repository.resolve_page_endpoint({
          namespace: "alice",
          page_name: `target-${index}`,
        }))?.page.page_id,
        "copy",
      );
    }
  } finally {
    kv.close();
  }
});
