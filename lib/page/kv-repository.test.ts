import { assert, assertEquals, assertRejects } from "@std/assert";
import { KvToolboxGateway } from "../storage/kv-toolbox-gateway.ts";
import type { PageRepository } from "./interfaces.ts";
import {
  DenoKvPageRepository,
  page_content_chunk_byte_length,
} from "./kv-repository.ts";
import {
  make_page_content,
  test_page_repository_conformance,
} from "./repository-conformance.ts";

const conformance_handles = new WeakMap<object, Deno.Kv>();

function gateway(kv: Deno.Kv): KvToolboxGateway {
  return new KvToolboxGateway(kv);
}

test_page_repository_conformance({
  name: "DenoKvPageRepository",
  make_repository: async () => {
    const kv = await Deno.openKv(":memory:");
    const repository = new DenoKvPageRepository(gateway(kv));
    conformance_handles.set(repository, kv);
    return repository;
  },
  teardown: (repository) => {
    conformance_handles.get(repository)?.close();
    conformance_handles.delete(repository);
  },
});

const t1 = new Date("2026-07-19T01:00:00.000Z");
const t2 = new Date("2026-07-19T02:00:00.000Z");

async function entries_with_prefix(
  kv: Deno.Kv,
  prefix: Deno.KvKey,
): Promise<Deno.KvEntry<unknown>[]> {
  const entries: Deno.KvEntry<unknown>[] = [];
  for await (const entry of kv.list<unknown>({ prefix })) entries.push(entry);
  return entries;
}

async function create_managed(repository: PageRepository) {
  const result = await repository.create_managed({
    page_id: "managed-1",
    locator: { namespace: "Alice", page_name: "Notes" },
    owner_user_id: "owner-1",
    access: "public",
    content: make_page_content("v1"),
    now: t1,
  });
  assert(result.ok);
  return result.page;
}

Deno.test("DenoKvPageRepository: state is shared across repository instances", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const page = await create_managed(new DenoKvPageRepository(gateway(kv)));
    const reader = new DenoKvPageRepository(gateway(kv));
    assertEquals(await reader.find_by_id(page.page_id), page);
    assertEquals(
      await reader.find_by_locator({ namespace: "ALICE", page_name: "notes" }),
      page,
    );
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvPageRepository: schema-v1 envelopes without tags remain readable", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvPageRepository(gateway(kv));
    const page = await create_managed(repository);
    const envelope_key = ["iam-pager", "pages", "by-id", page.page_id];
    const envelope = (await kv.get<Record<string, unknown>>(envelope_key))
      .value!;
    const { tags: _tags, ...legacy_envelope } = envelope;
    await kv.set(envelope_key, legacy_envelope);
    assertEquals(await repository.find_by_id(page.page_id), page);
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvPageRepository: fresh keyspace separates envelope, indexes, and chunks", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const page = await create_managed(new DenoKvPageRepository(gateway(kv)));
    const envelope = await kv.get<Record<string, unknown>>([
      "iam-pager",
      "pages",
      "by-id",
      "managed-1",
    ]);
    assert(envelope.versionstamp !== null);
    const generation = envelope.value?.generation;
    assert(typeof generation === "string");
    assertEquals(envelope.value, {
      schema_version: 1,
      page_id: "managed-1",
      namespace: "Alice",
      page_name: "Notes",
      stewardship: "managed",
      owner_user_id: "owner-1",
      access: "public",
      tags: [],
      revision: 1,
      content_type: "md-page",
      media_type: "text/html; charset=utf-8",
      size_bytes: 2,
      created_at: t1.toISOString(),
      updated_at: t1.toISOString(),
      data_encoding: "tagged-json-v1",
      generation,
      chunk_count: 1,
      data_byte_length: envelope.value?.data_byte_length,
    });
    assertEquals(
      (await kv.get([
        "iam-pager",
        "pages",
        "by-locator",
        "alice",
        1,
        "notes",
      ])).value,
      { schema_version: 1, page_id: "managed-1" },
    );
    assertEquals(
      (await kv.get([
        "iam-pager",
        "pages",
        "by-owner",
        "owner-1",
        "alice",
        1,
        "notes",
        "managed-1",
      ])).value,
      { schema_version: 1, page_id: "managed-1", revision: 1 },
    );
    const chunks = await entries_with_prefix(kv, [
      "iam-pager",
      "pages",
      "chunks",
      page.page_id,
      generation,
    ]);
    assertEquals(chunks.length, 1);
    assert(chunks[0].value instanceof Uint8Array);
    assertEquals(
      (await entries_with_prefix(kv, ["iam-pager", "content-pages"])).length,
      0,
    );
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvPageRepository: content swaps generations while access-only updates retain chunks", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvPageRepository(gateway(kv));
    await create_managed(repository);
    const envelope_key = ["iam-pager", "pages", "by-id", "managed-1"];
    const first = (await kv.get<{ generation: string }>(envelope_key)).value!;
    const access_only = await repository.replace_managed({
      page_id: "managed-1",
      owner_user_id: "owner-1",
      expected_revision: 1,
      access: "private",
      now: t2,
    });
    assert(access_only.ok);
    const second = (await kv.get<{ generation: string }>(envelope_key)).value!;
    assertEquals(second.generation, first.generation);

    const content_update = await repository.replace_managed({
      page_id: "managed-1",
      owner_user_id: "owner-1",
      expected_revision: 2,
      access: "private",
      content: make_page_content(
        "x".repeat(2 * page_content_chunk_byte_length),
      ),
      now: new Date("2026-07-19T03:00:00.000Z"),
    });
    assert(content_update.ok);
    const third = (await kv.get<{ generation: string }>(envelope_key)).value!;
    assert(third.generation !== first.generation);
    assertEquals(
      await entries_with_prefix(kv, [
        "iam-pager",
        "pages",
        "chunks",
        "managed-1",
        first.generation,
      ]),
      [],
    );
    assertEquals(await repository.find_by_id("managed-1"), content_update.page);
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvPageRepository: managed deletion removes envelope, both indexes, and chunks", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvPageRepository(gateway(kv));
    await create_managed(repository);
    assertEquals(
      await repository.delete_managed({
        page_id: "managed-1",
        owner_user_id: "owner-1",
        expected_revision: 1,
      }),
      { ok: true },
    );
    assertEquals(
      await entries_with_prefix(kv, ["iam-pager", "pages"]),
      [],
    );
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvPageRepository: rejects unsupported durable data before visibility", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvPageRepository(gateway(kv));
    await assertRejects(
      () =>
        repository.put_trial({
          page_id: "trial-1",
          locator: { namespace: "trial" },
          content: {
            ...make_page_content("bad"),
            data: { value: 1n },
          },
          now: t1,
        }),
      TypeError,
      "JSON-compatible or Uint8Array",
    );
    assertEquals(await entries_with_prefix(kv, ["iam-pager", "pages"]), []);
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvPageRepository: stable malformed envelopes and indexes are corruption", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvPageRepository(gateway(kv));
    await create_managed(repository);
    const envelope_key = ["iam-pager", "pages", "by-id", "managed-1"];
    const valid_envelope = (await kv.get<Record<string, unknown>>(envelope_key))
      .value!;
    await kv.set(envelope_key, { ...valid_envelope, schema_version: 2 });
    await assertRejects(
      () => repository.find_by_id("managed-1"),
      TypeError,
      "invalid stored page",
    );

    await kv.set(envelope_key, valid_envelope);
    const locator_key = [
      "iam-pager",
      "pages",
      "by-locator",
      "alice",
      1,
      "notes",
    ];
    await kv.set(locator_key, { schema_version: 1, page_id: "other-id" });
    await assertRejects(
      () =>
        repository.find_by_locator({ namespace: "alice", page_name: "notes" }),
      Error,
      "invariant violated",
    );

    await kv.set(locator_key, { schema_version: 1, page_id: "managed-1" });
    await kv.delete([
      "iam-pager",
      "pages",
      "by-owner",
      "owner-1",
      "alice",
      1,
      "notes",
      "managed-1",
    ]);
    await assertRejects(
      () => repository.find_by_id("managed-1"),
      Error,
      "invariant violated",
    );
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvPageRepository: missing or malformed chunks of a stable envelope are corruption", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvPageRepository(gateway(kv));
    await create_managed(repository);
    const envelope = (await kv.get<{ generation: string }>([
      "iam-pager",
      "pages",
      "by-id",
      "managed-1",
    ])).value!;
    const chunk_key = [
      "iam-pager",
      "pages",
      "chunks",
      "managed-1",
      envelope.generation,
      0,
    ];
    await kv.delete(chunk_key);
    await assertRejects(
      () => repository.find_by_id("managed-1"),
      TypeError,
      "invalid stored page",
    );
  } finally {
    kv.close();
  }
});
