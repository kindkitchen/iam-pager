import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ContentAsset } from "../content/asset.ts";
import { PdfHandler } from "../content/pdf.ts";
import {
  content_data_encoding_v8_1,
  V8ContentDataCodec,
} from "./content-data-codec.ts";
import type { KvGateway } from "./kv-gateway.ts";
import {
  content_asset_manifest_key,
  content_asset_payload_key,
  content_asset_payload_prefix,
  type ContentAssetPayloadIdGenerator,
  KvContentAssetRepository,
  type StoredContentAssetManifest,
} from "./kv-content-asset-repository.ts";
import { KvToolboxGateway } from "./kv-toolbox-gateway.ts";

const created_at = new Date("2026-07-20T12:00:00.000Z");

class SequencePayloadIdGenerator implements ContentAssetPayloadIdGenerator {
  readonly #ids: string[];

  constructor(ids: readonly string[]) {
    this.#ids = [...ids];
  }

  generate(): string {
    const id = this.#ids.shift();
    if (id === undefined) throw new Error("payload id sequence exhausted");
    return id;
  }
}

function repository(
  kv: Deno.Kv,
  payload_ids: readonly string[] = [],
): KvContentAssetRepository {
  return new KvContentAssetRepository(new KvToolboxGateway(kv), {
    ...(payload_ids.length === 0 ? {} : {
      payload_id_generator: new SequencePayloadIdGenerator(payload_ids),
    }),
  });
}

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

function make_pdf_asset(
  content_asset_id: string,
  value: Uint8Array,
): ContentAsset {
  const filename = `${content_asset_id}.pdf`;
  const handler = new PdfHandler();
  const accepted = handler.validate({ bytes: value, filename });
  assert(accepted.ok);
  return {
    content_asset_id,
    content_type: handler.content_type,
    data: handler.derive(accepted.value),
    meta: {
      media_type: "application/pdf",
      size_bytes: value.byteLength,
      download_filename: filename,
    },
    created_at,
  };
}

function accepted_pdf_bytes(byte_length: number): Uint8Array {
  const encoder = new TextEncoder();
  const header = encoder.encode("%PDF-2.0\n");
  let xref_offset = byte_length;
  let suffix = new Uint8Array();
  while (true) {
    suffix = encoder.encode(
      "xref\n0 1\n0000000000 65535 f \n" +
        "trailer\n<< /Size 1 >>\n" +
        `startxref\n${xref_offset}\n%%EOF\n`,
    );
    const next_offset = byte_length - suffix.byteLength;
    if (next_offset === xref_offset) break;
    xref_offset = next_offset;
  }
  assert(xref_offset >= header.byteLength);
  const value = new Uint8Array(byte_length);
  value.fill(0x20);
  value.set(header);
  value.set(suffix, xref_offset);
  return value;
}

function bytes(byte_length: number): Uint8Array {
  const value = new Uint8Array(byte_length);
  for (let index = 0; index < value.length; index += 1) {
    value[index] = (index * 31 + 17) % 256;
  }
  return value;
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value.slice());
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function list_entries(
  kv: Deno.Kv,
  prefix: Deno.KvKey,
): Promise<Deno.KvEntry<unknown>[]> {
  const entries: Deno.KvEntry<unknown>[] = [];
  for await (const entry of kv.list({ prefix })) entries.push(entry);
  return entries;
}

async function stored_payload_ids(kv: Deno.Kv): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const entry of await list_entries(kv, content_asset_payload_prefix)) {
    const id = entry.key[content_asset_payload_prefix.length];
    assert(typeof id === "string");
    ids.add(id);
  }
  return ids;
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

function with_first_get_barrier(
  gateway: KvGateway,
  participant_count: number,
): KvGateway {
  let observed = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  return new Proxy(gateway, {
    get(target, property) {
      if (property === "get") {
        return async (
          key: Deno.KvKey,
          options?: { consistency?: Deno.KvConsistencyLevel },
        ) => {
          const entry = await target.get(key, options);
          observed += 1;
          if (observed === participant_count) release();
          await barrier;
          return entry;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function with_corrupt_binary_reads(gateway: KvGateway): KvGateway {
  return new Proxy(gateway, {
    get(target, property) {
      if (property === "read_binary_object") {
        return async (key: Deno.KvKey) => {
          const found = await target.read_binary_object(key);
          if (found !== null) found[0] ^= 0xff;
          return found;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function with_ambiguous_native_commit(gateway: KvGateway): KvGateway {
  return new Proxy(gateway, {
    get(target, property) {
      if (property === "native_atomic") {
        return () => {
          const operation = target.native_atomic();
          const proxy: Deno.AtomicOperation = new Proxy(operation, {
            get(operation_target, operation_property) {
              if (operation_property === "commit") {
                return async () => {
                  await operation_target.commit();
                  throw new Error("manifest commit response lost");
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

Deno.test("KV content assets preserve immutable identities and strict manifests", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const subject = repository(kv, ["payload-one"]);
    const input = make_asset("asset-1", { marker: "original" });
    const creating = subject.create_content_asset(input);
    (input.data as { marker: string }).marker = "mutated-in-flight";
    const created = await creating;
    assert(created.ok);

    const encoded = new V8ContentDataCodec().encode({ marker: "original" });
    assertEquals(
      (await kv.get(content_asset_manifest_key("asset-1"))).value,
      {
        schema_version: 1,
        data_encoding: content_data_encoding_v8_1,
        content_asset_id: "asset-1",
        payload_id: "payload-one",
        payload_byte_length: encoded.byteLength,
        payload_sha256: await sha256(encoded),
        content_type: "test-content",
        media_type: "application/octet-stream",
        size_bytes: 1,
        download_filename: "asset-1.bin",
        created_at: created_at.toISOString(),
      },
    );

    (created.asset.data as { marker: string }).marker = "mutated-result";
    assertEquals(
      await subject.create_content_asset(
        make_asset("asset-1", { marker: "replacement" }),
      ),
      { ok: false, reason: "content_asset_id_conflict" },
    );

    const found = await repository(kv).find_content_asset_by_id("asset-1");
    assert(found !== null);
    assertEquals(found, make_asset("asset-1", { marker: "original" }));
    (found.data as { marker: string }).marker = "mutated-read";
    assertEquals(
      (await repository(kv).find_content_asset_by_id("asset-1"))?.data,
      { marker: "original" },
    );
    assertEquals(
      await repository(kv).find_content_asset_by_id("missing"),
      null,
    );
  } finally {
    kv.close();
  }
});

Deno.test("concurrent KV asset creation has one native-CAS winner without staging leaks", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const subject = new KvContentAssetRepository(
      with_first_get_barrier(new KvToolboxGateway(kv), 2),
      {
        payload_id_generator: new SequencePayloadIdGenerator([
          "payload-first",
          "payload-second",
        ]),
      },
    );
    const results = await Promise.all([
      subject.create_content_asset(
        make_asset("shared-id", { marker: "first" }),
      ),
      subject.create_content_asset(
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
      await repository(kv).find_content_asset_by_id("shared-id"),
      winner.asset,
    );
    assertEquals((await stored_payload_ids(kv)).size, 1);
  } finally {
    kv.close();
  }
});

Deno.test("KV content assets round-trip multi-part and maximum accepted PDF data across fresh repositories", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    for (
      const [content_asset_id, byte_length, payload_id] of [
        ["one-mib-pdf", 1024 * 1024, "payload-one-mib"],
        ["maximum-pdf", 16 * 1024 * 1024, "payload-maximum"],
      ] as const
    ) {
      const value = accepted_pdf_bytes(byte_length);
      const expected_sha256 = await sha256(value);
      const created = await repository(kv, [payload_id]).create_content_asset(
        make_pdf_asset(content_asset_id, value),
      );
      assert(created.ok);
      value.fill(0);

      const found = await repository(kv).find_content_asset_by_id(
        content_asset_id,
      );
      assert(found !== null);
      const data = found.data as {
        bytes: Uint8Array;
        filename: string;
        pdf_version: string;
      };
      assertEquals(data.bytes.byteLength, byte_length);
      assertEquals(await sha256(data.bytes), expected_sha256);
      assertEquals(data.filename, `${content_asset_id}.pdf`);
      assertEquals(data.pdf_version, "2.0");
    }
  } finally {
    kv.close();
  }
});

Deno.test("failed later binary batches never publish a KV asset and permit retry", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const interrupted = new KvContentAssetRepository(
      new KvToolboxGateway(with_failed_atomic_commit(kv, 2)),
      {
        payload_id_generator: new SequencePayloadIdGenerator([
          "interrupted-payload",
        ]),
      },
    );
    const asset = make_pdf_asset(
      "interrupted-pdf",
      accepted_pdf_bytes(1024 * 1024),
    );
    await assertRejects(
      () => interrupted.create_content_asset(asset),
      Error,
    );

    assertEquals(
      await repository(kv).find_content_asset_by_id("interrupted-pdf"),
      null,
    );
    assertEquals(await stored_payload_ids(kv), new Set());

    const retried = await repository(kv, ["retry-payload"])
      .create_content_asset(asset);
    assert(retried.ok);
    assertEquals(
      await repository(kv).find_content_asset_by_id("interrupted-pdf"),
      retried.asset,
    );
  } finally {
    kv.close();
  }
});

Deno.test("failed repository-level payload verification removes staging before visibility", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const subject = new KvContentAssetRepository(
      with_corrupt_binary_reads(new KvToolboxGateway(kv)),
      {
        payload_id_generator: new SequencePayloadIdGenerator([
          "corrupt-staging",
        ]),
      },
    );
    await assertRejects(
      () =>
        subject.create_content_asset(
          make_asset("unverified", { marker: "never-visible" }),
        ),
      TypeError,
      "invalid stored content asset",
    );
    assertEquals(
      (await kv.get(content_asset_manifest_key("unverified"))).value,
      null,
    );
    assertEquals(await stored_payload_ids(kv), new Set());
  } finally {
    kv.close();
  }
});

Deno.test("KV content asset reads reject corrupt chunks, manifests, hashes, and codec data", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const chunk_subject = repository(kv, ["payload-corrupt-chunk"]);
    const chunk_created = await chunk_subject.create_content_asset(
      make_asset("corrupt-chunk", bytes(256 * 1024)),
    );
    assert(chunk_created.ok);
    const chunk = (await list_entries(
      kv,
      content_asset_payload_key("payload-corrupt-chunk"),
    )).find((entry) => entry.value instanceof Uint8Array);
    assert(chunk !== undefined && chunk.value instanceof Uint8Array);
    const corrupted = chunk.value.slice();
    corrupted[0] ^= 0xff;
    await kv.set(chunk.key, corrupted);
    await assertRejects(
      () => repository(kv).find_content_asset_by_id("corrupt-chunk"),
      TypeError,
      "invalid stored content asset",
    );

    const hash_created = await repository(kv, ["payload-corrupt-hash"])
      .create_content_asset(make_asset("corrupt-hash", { value: 1 }));
    assert(hash_created.ok);
    const hash_key = content_asset_manifest_key("corrupt-hash");
    const hash_manifest = (await kv.get<StoredContentAssetManifest>(hash_key))
      .value!;
    await kv.set(hash_key, {
      ...hash_manifest,
      payload_byte_length: hash_manifest.payload_byte_length + 1,
    });
    await assertRejects(
      () => repository(kv).find_content_asset_by_id("corrupt-hash"),
      TypeError,
      "invalid stored content asset",
    );
    await kv.set(hash_key, {
      ...hash_manifest,
      payload_sha256: "0".repeat(64),
    });
    await assertRejects(
      () => repository(kv).find_content_asset_by_id("corrupt-hash"),
      TypeError,
      "invalid stored content asset",
    );

    const encoding_created = await repository(kv, ["payload-bad-encoding"])
      .create_content_asset(make_asset("bad-encoding", { value: 2 }));
    assert(encoding_created.ok);
    const encoding_key = content_asset_manifest_key("bad-encoding");
    const encoding_manifest = (await kv.get<StoredContentAssetManifest>(
      encoding_key,
    )).value!;
    await kv.set(encoding_key, {
      ...encoding_manifest,
      data_encoding: "unknown-1",
    });
    await assertRejects(
      () => repository(kv).find_content_asset_by_id("bad-encoding"),
      TypeError,
      "invalid stored content asset",
    );

    const malformed_bytes = Uint8Array.of(1, 2, 3);
    const gateway = new KvToolboxGateway(kv);
    await gateway.stage_binary_object(
      content_asset_payload_key("payload-bad-codec"),
      malformed_bytes,
    );
    const malformed_manifest: StoredContentAssetManifest = {
      schema_version: 1,
      data_encoding: content_data_encoding_v8_1,
      content_asset_id: "bad-codec",
      payload_id: "payload-bad-codec",
      payload_byte_length: malformed_bytes.byteLength,
      payload_sha256: await sha256(malformed_bytes),
      content_type: "test-content",
      media_type: "application/octet-stream",
      size_bytes: 1,
      created_at: created_at.toISOString(),
    };
    await kv.set(content_asset_manifest_key("bad-codec"), malformed_manifest);
    await assertRejects(
      () => repository(kv).find_content_asset_by_id("bad-codec"),
      TypeError,
      "invalid stored content asset",
    );
  } finally {
    kv.close();
  }
});

Deno.test("ambiguous native manifest outcomes retain payloads that may be visible", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const asset = make_asset("ambiguous", { marker: "committed" });
    const subject = new KvContentAssetRepository(
      with_ambiguous_native_commit(new KvToolboxGateway(kv)),
      {
        payload_id_generator: new SequencePayloadIdGenerator([
          "payload-ambiguous",
        ]),
      },
    );
    await assertRejects(
      () => subject.create_content_asset(asset),
      Error,
      "manifest commit response lost",
    );

    assertEquals(await stored_payload_ids(kv), new Set(["payload-ambiguous"]));
    assertEquals(
      await repository(kv).find_content_asset_by_id("ambiguous"),
      asset,
    );
    assertEquals(
      await repository(kv).create_content_asset(asset),
      { ok: false, reason: "content_asset_id_conflict" },
    );
    assertEquals(await stored_payload_ids(kv), new Set(["payload-ambiguous"]));
  } finally {
    kv.close();
  }
});

Deno.test("KV content assets remain isolated from the legacy raw page keyspace", async () => {
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

    const created = await repository(kv, ["isolated-payload"])
      .create_content_asset(make_asset("isolated", { marker: "new" }));
    assert(created.ok);
    assertEquals((await kv.get(legacy_key)).value, legacy_value);
    assertEquals(await stored_payload_ids(kv), new Set(["isolated-payload"]));
  } finally {
    kv.close();
  }
});
