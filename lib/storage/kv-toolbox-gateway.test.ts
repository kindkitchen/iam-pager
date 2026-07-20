import { assert, assertEquals, assertRejects } from "@std/assert";
import { KvToolboxGateway } from "./kv-toolbox-gateway.ts";

function bytes(byte_length: number): Uint8Array {
  const value = new Uint8Array(byte_length);
  for (let index = 0; index < value.length; index++) {
    value[index] = (index * 31 + 17) % 256;
  }
  return value;
}

async function list_entries(
  kv: Deno.Kv,
  prefix: Deno.KvKey,
): Promise<Deno.KvEntry<unknown>[]> {
  const entries: Deno.KvEntry<unknown>[] = [];
  for await (const entry of kv.list({ prefix })) entries.push(entry);
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

async function sha256(value: Uint8Array): Promise<string> {
  const detached = value.slice();
  const digest = await crypto.subtle.digest("SHA-256", detached);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

Deno.test("kv-toolbox gateway delegates records and keeps native CAS all-or-none", async () => {
  const gateway = new KvToolboxGateway(await Deno.openKv(":memory:"));
  try {
    const first_key: Deno.KvKey = ["gateway", "records", "first"];
    const second_key: Deno.KvKey = ["gateway", "records", "second"];
    assert((await gateway.set(first_key, { value: 1 })).ok);
    assert((await gateway.set(second_key, { value: 2 })).ok);

    const [first, second] = await gateway.get_many<
      readonly [{ value: number }, { value: number }]
    >([first_key, second_key]);
    assertEquals(first.value, { value: 1 });
    assertEquals(second.value, { value: 2 });
    assertEquals(
      (await Array.fromAsync(gateway.list({
        prefix: ["gateway", "records"],
      }))).map((entry) => entry.value),
      [{ value: 1 }, { value: 2 }],
    );

    assert((await gateway.set(first_key, { value: 3 })).ok);
    const rejected = await gateway.native_atomic()
      .check(first)
      .set(first_key, { value: 4 })
      .delete(second_key)
      .commit();
    assertEquals(rejected, { ok: false });
    assertEquals((await gateway.get(first_key)).value, { value: 3 });
    assertEquals((await gateway.get(second_key)).value, { value: 2 });

    const current = await gateway.get(first_key);
    const committed = await gateway.native_atomic()
      .check(current)
      .set(first_key, { value: 4 })
      .delete(second_key)
      .commit();
    assert(!Array.isArray(committed));
    assert(committed.ok);
    assertEquals((await gateway.get(first_key)).value, { value: 4 });
    assertEquals((await gateway.get(second_key)).value, null);

    await gateway.delete(first_key);
    assertEquals((await gateway.get(first_key)).value, null);
  } finally {
    gateway.close();
  }
});

Deno.test("kv-toolbox gateway stages detached multi-part bytes across fresh wrappers", async () => {
  const kv = await Deno.openKv(":memory:");
  const first = new KvToolboxGateway(kv);
  const second = new KvToolboxGateway(kv);
  try {
    const key: Deno.KvKey = ["gateway", "binary", "one-mib"];
    const backing = bytes(1024 * 1024 + 10);
    const input = backing.subarray(5, backing.length - 5);
    const expected = input.slice();
    await first.stage_binary_object(key, input);
    backing.fill(0);

    const metadata = await second.get_binary_object_metadata(key);
    assertEquals(metadata?.byte_length, expected.byteLength);
    const found = await second.read_binary_object(key);
    assertEquals(found, expected);
    found?.fill(0);
    assertEquals(await first.read_binary_object(key), expected);
  } finally {
    first.close();
  }
});

Deno.test("kv-toolbox gateway round-trips the maximum accepted PDF payload", async () => {
  const gateway = new KvToolboxGateway(await Deno.openKv(":memory:"));
  try {
    const payload = bytes(16 * 1024 * 1024);
    await gateway.stage_binary_object(
      ["gateway", "binary", "maximum-pdf"],
      payload,
    );
    const found = await gateway.read_binary_object([
      "gateway",
      "binary",
      "maximum-pdf",
    ]);
    assert(found !== null);
    assertEquals(found.byteLength, payload.byteLength);
    assertEquals(await sha256(found), await sha256(payload));
  } finally {
    gateway.close();
  }
});

Deno.test("kv-toolbox gateway enforces staging and removal policy", async () => {
  const kv = await Deno.openKv(":memory:");
  const gateway = new KvToolboxGateway(kv);
  const key: Deno.KvKey = ["gateway", "binary", "policy"];
  try {
    await assertRejects(
      () => gateway.stage_binary_object(key, new Uint8Array()),
      TypeError,
      "non-empty Uint8Array",
    );
    await gateway.stage_binary_object(key, Uint8Array.of(1, 2, 3));
    await assertRejects(
      () => gateway.stage_binary_object(key, Uint8Array.of(4)),
      TypeError,
      "must be unused",
    );

    await gateway.remove_binary_object(key);
    assertEquals(await gateway.get_binary_object_metadata(key), null);
    assertEquals(await gateway.read_binary_object(key), null);
    assertEquals(await list_entries(kv, key), []);

    const metadata_only_key: Deno.KvKey = [
      "gateway",
      "binary",
      "metadata-only",
    ];
    await gateway.stage_binary_object(
      metadata_only_key,
      Uint8Array.of(1, 2, 3),
    );
    const metadata_only_entries = await list_entries(kv, metadata_only_key);
    for (
      const entry of metadata_only_entries.filter((entry) =>
        entry.value instanceof Uint8Array
      )
    ) {
      await kv.delete(entry.key);
    }
    assert(
      (await list_entries(kv, metadata_only_key)).some((entry) =>
        !(entry.value instanceof Uint8Array)
      ),
    );
    await gateway.remove_binary_object(metadata_only_key);
    assertEquals(await list_entries(kv, metadata_only_key), []);
  } finally {
    gateway.close();
  }
});

Deno.test("kv-toolbox gateway rejects missing, truncated, and malformed binary state", async () => {
  const kv = await Deno.openKv(":memory:");
  const gateway = new KvToolboxGateway(kv);
  try {
    const missing_metadata_key: Deno.KvKey = [
      "gateway",
      "binary",
      "missing-metadata",
    ];
    await gateway.stage_binary_object(
      missing_metadata_key,
      bytes(128 * 1024),
    );
    const missing_metadata_entries = await list_entries(
      kv,
      missing_metadata_key,
    );
    const metadata_entry = missing_metadata_entries.find((entry) =>
      !(entry.value instanceof Uint8Array)
    );
    assert(metadata_entry !== undefined);
    await kv.delete(metadata_entry.key);
    assertEquals(
      await gateway.get_binary_object_metadata(missing_metadata_key),
      null,
    );
    assertEquals(await gateway.read_binary_object(missing_metadata_key), null);
    await gateway.remove_binary_object(missing_metadata_key);

    const missing_chunk_key: Deno.KvKey = [
      "gateway",
      "binary",
      "missing-chunk",
    ];
    await gateway.stage_binary_object(missing_chunk_key, bytes(128 * 1024));
    const chunk_entries = (await list_entries(kv, missing_chunk_key)).filter(
      (entry) => entry.value instanceof Uint8Array,
    );
    assert(chunk_entries.length > 1);
    await kv.delete(chunk_entries[0].key);
    await assertRejects(
      () => gateway.read_binary_object(missing_chunk_key),
      TypeError,
      "invalid stored binary object",
    );
    await gateway.remove_binary_object(missing_chunk_key);

    const truncated_key: Deno.KvKey = ["gateway", "binary", "truncated"];
    await gateway.stage_binary_object(truncated_key, bytes(128 * 1024));
    const truncated_chunks = (await list_entries(kv, truncated_key)).filter(
      (entry): entry is Deno.KvEntry<Uint8Array> =>
        entry.value instanceof Uint8Array,
    );
    const last_chunk = truncated_chunks.at(-1);
    assert(last_chunk !== undefined && last_chunk.value.length > 1);
    await kv.set(last_chunk.key, last_chunk.value.slice(0, -1));
    await assertRejects(
      () => gateway.read_binary_object(truncated_key),
      TypeError,
      "invalid stored binary object",
    );

    const truncated_entries = await list_entries(kv, truncated_key);
    const truncated_metadata = truncated_entries.find((entry) =>
      !(entry.value instanceof Uint8Array)
    );
    assert(truncated_metadata !== undefined);
    await kv.set(truncated_metadata.key, { kind: "buffer", size: -1 });
    await assertRejects(
      () => gateway.get_binary_object_metadata(truncated_key),
      TypeError,
      "invalid stored binary object metadata",
    );
  } finally {
    gateway.close();
  }
});

Deno.test("failed kv-toolbox binary batches are cleaned and retryable", async () => {
  const kv = await Deno.openKv(":memory:");
  const interrupted = new KvToolboxGateway(with_failed_atomic_commit(kv, 2));
  const key: Deno.KvKey = ["gateway", "binary", "interrupted"];
  const payload = bytes(1024 * 1024);
  try {
    await assertRejects(
      () => interrupted.stage_binary_object(key, payload),
      Error,
    );
    assertEquals(await list_entries(kv, key), []);

    const healthy = new KvToolboxGateway(kv);
    await healthy.stage_binary_object(key, payload);
    assertEquals(await healthy.read_binary_object(key), payload);
  } finally {
    interrupted.close();
  }
});

Deno.test("kv-toolbox gateway owns the supplied database lifecycle", async () => {
  const kv = await Deno.openKv(":memory:");
  const gateway = new KvToolboxGateway(kv);
  await gateway.set(["gateway", "lifecycle"], true);
  gateway.close();
  await assertRejects(() => kv.get(["gateway", "lifecycle"]), Error);
  await assertRejects(() => gateway.get(["gateway", "lifecycle"]), Error);
});
