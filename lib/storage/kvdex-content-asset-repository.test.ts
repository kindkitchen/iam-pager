import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ContentAsset } from "../content/asset.ts";
import { KvdexContentAssetRepository } from "./kvdex-content-asset-repository.ts";

const created_at = new Date("2026-07-20T12:00:00.000Z");

function make_asset(
  content_asset_id: string,
  data: unknown,
  size_bytes = data instanceof Uint8Array ? data.length : 1,
): ContentAsset {
  return {
    content_asset_id,
    content_type: data instanceof Uint8Array ? "pdf" : "test-content",
    data,
    meta: {
      media_type: data instanceof Uint8Array
        ? "application/pdf"
        : "application/octet-stream",
      size_bytes,
      download_filename: `${content_asset_id}.bin`,
    },
    created_at,
  };
}

function bytes(byte_length: number): Uint8Array {
  return Uint8Array.from(
    { length: byte_length },
    (_, index) => (index * 31 + 17) % 256,
  );
}

async function list_kvdex_entries(
  kv: Deno.Kv,
): Promise<Deno.KvEntry<unknown>[]> {
  const entries: Deno.KvEntry<unknown>[] = [];
  for await (const entry of kv.list({ prefix: ["__kvdex__"] })) {
    entries.push(entry);
  }
  return entries;
}

function with_failed_atomic_commit(
  kv: Deno.Kv,
  failed_commit_number: number,
): Deno.Kv {
  let commit_count = 0;
  return new Proxy(kv, {
    get(target, property) {
      if (property === "atomic") {
        return () => {
          const atomic = target.atomic();
          return new Proxy(atomic, {
            get(atomic_target, atomic_property) {
              if (atomic_property === "commit") {
                return () => {
                  commit_count += 1;
                  if (commit_count === failed_commit_number) {
                    return Promise.resolve({ ok: false as const });
                  }
                  return atomic_target.commit();
                };
              }
              const value = Reflect.get(atomic_target, atomic_property);
              return typeof value === "function"
                ? value.bind(atomic_target)
                : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

Deno.test("Kvdex content assets preserve immutable identities and isolated values", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new KvdexContentAssetRepository(kv);
    const input = make_asset("asset-1", { marker: "original" });
    const created = await repository.create_content_asset(input);
    assert(created.ok);

    (input.data as { marker: string }).marker = "mutated-input";
    (created.asset.data as { marker: string }).marker = "mutated-result";
    assertEquals(
      await repository.create_content_asset(
        make_asset("asset-1", { marker: "replacement" }),
      ),
      { ok: false, reason: "content_asset_id_conflict" },
    );

    const found = await repository.find_content_asset_by_id("asset-1");
    assert(found !== null);
    assertEquals(found, make_asset("asset-1", { marker: "original" }));
    (found.data as { marker: string }).marker = "mutated-read";
    assertEquals(
      (await repository.find_content_asset_by_id("asset-1"))?.data,
      { marker: "original" },
    );
    assertEquals(await repository.find_content_asset_by_id("missing"), null);
  } finally {
    kv.close();
  }
});

Deno.test("concurrent Kvdex asset creation has one immutable winner without staging leaks", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new KvdexContentAssetRepository(kv);
    const results = await Promise.all([
      repository.create_content_asset(
        make_asset("shared-id", { marker: "first" }),
      ),
      repository.create_content_asset(
        make_asset("shared-id", { marker: "second" }),
      ),
    ]);
    assertEquals(results.filter((result) => result.ok).length, 1);
    assertEquals(
      results.filter((result) => !result.ok),
      [{ ok: false, reason: "content_asset_id_conflict" }],
    );
    const winner = results.find((result) => result.ok);
    assert(winner?.ok);
    assertEquals(
      await repository.find_content_asset_by_id("shared-id"),
      winner.asset,
    );

    const entries = await list_kvdex_entries(kv);
    assertEquals(
      entries.filter((entry) => entry.key.includes("__segment__")).length,
      1,
    );
    assertEquals(
      entries.filter((entry) => entry.key.includes("__id__")).length,
      2,
    );
  } finally {
    kv.close();
  }
});

Deno.test("Kvdex content assets round-trip multi-segment bytes across repository instances", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const payload = bytes(1024 * 1024);
    const first = new KvdexContentAssetRepository(kv);
    const created = await first.create_content_asset(
      make_asset("large-pdf", payload),
    );
    assert(created.ok);

    payload.fill(0);
    const second = new KvdexContentAssetRepository(kv);
    const found = await second.find_content_asset_by_id("large-pdf");
    assert(found !== null);
    assertEquals(found.data, bytes(1024 * 1024));

    const segments = (await list_kvdex_entries(kv)).filter((entry) =>
      entry.key.includes("__segment__")
    );
    assert(segments.length > 1);
    assert(
      segments.every((entry) =>
        entry.value instanceof Uint8Array && entry.value.length <= 64 * 1024
      ),
    );
  } finally {
    kv.close();
  }
});

Deno.test("failed Kvdex payload batches never publish an asset and permit retry", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const interrupted = new KvdexContentAssetRepository(
      with_failed_atomic_commit(kv, 2),
    );
    const asset = make_asset("interrupted-pdf", bytes(1024 * 1024));
    await assertRejects(
      () => interrupted.create_content_asset(asset),
      Error,
      "failed to stage payload",
    );

    const healthy = new KvdexContentAssetRepository(kv);
    assertEquals(
      await healthy.find_content_asset_by_id("interrupted-pdf"),
      null,
    );
    assertEquals((await list_kvdex_entries(kv)).length, 0);

    const retried = await healthy.create_content_asset(asset);
    assert(retried.ok);
    assertEquals(
      (await healthy.find_content_asset_by_id("interrupted-pdf"))?.data,
      asset.data,
    );
  } finally {
    kv.close();
  }
});

Deno.test("Kvdex content asset reads reject corrupt encoded segments", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new KvdexContentAssetRepository(kv);
    const created = await repository.create_content_asset(
      make_asset("corrupt-pdf", bytes(256 * 1024)),
    );
    assert(created.ok);

    const segment = (await list_kvdex_entries(kv)).find((entry) =>
      entry.key.includes("__segment__")
    );
    assert(segment !== undefined);
    assert(segment.value instanceof Uint8Array);
    const corrupted = segment.value.slice();
    corrupted[0] ^= 0xff;
    await kv.set([...segment.key], corrupted);

    await assertRejects(
      () =>
        new KvdexContentAssetRepository(kv).find_content_asset_by_id(
          "corrupt-pdf",
        ),
      TypeError,
      "invalid stored content asset",
    );
  } finally {
    kv.close();
  }
});

Deno.test("Kvdex content assets do not overwrite the legacy raw page keyspace", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const legacy_key: Deno.KvKey = [
      "iam-pager",
      "pages",
      "by-id",
      "legacy-page",
    ];
    const legacy_value = { schema_version: 1, marker: "legacy" };
    await kv.set(legacy_key, legacy_value);

    const repository = new KvdexContentAssetRepository(kv);
    const created = await repository.create_content_asset(
      make_asset("asset-1", { marker: "new" }),
    );
    assert(created.ok);
    assertEquals((await kv.get(legacy_key)).value, legacy_value);
    assert(
      (await list_kvdex_entries(kv)).every((entry) =>
        entry.key[0] === "__kvdex__"
      ),
    );
  } finally {
    kv.close();
  }
});
