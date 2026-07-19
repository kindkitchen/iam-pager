import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ContentRepository } from "./interfaces.ts";
import {
  content_chunk_byte_length,
  DenoKvContentRepository,
} from "./kv-repository.ts";
import type { PageRecord } from "./model.ts";
import {
  make_conformance_page,
  test_content_repository_conformance,
} from "./repository-conformance.ts";

const conformance_handles = new WeakMap<object, Deno.Kv>();

test_content_repository_conformance({
  name: "DenoKvContentRepository",
  make_repository: async () => {
    const kv = await Deno.openKv(":memory:");
    const repository = new DenoKvContentRepository(kv);
    conformance_handles.set(repository, kv);
    return repository;
  },
  teardown: (repository) => {
    conformance_handles.get(repository)?.close();
    conformance_handles.delete(repository);
  },
});

function page_with_md(md: string): PageRecord {
  return {
    locator: { namespace: "MyNs", page_name: "MyPage" },
    content: {
      content_type: "md-page",
      data: { md, html: `<p>${md}</p>` },
      meta: { media_type: "text/html; charset=utf-8", size_bytes: md.length },
      created_at: new Date("2026-07-18T00:00:00.000Z"),
      updated_at: new Date("2026-07-18T12:00:00.000Z"),
    },
  };
}

async function chunk_entries(kv: Deno.Kv): Promise<Deno.KvEntry<unknown>[]> {
  const entries: Deno.KvEntry<unknown>[] = [];
  for await (
    const entry of kv.list<unknown>({
      prefix: ["iam-pager", "content-pages", "chunks"],
    })
  ) {
    entries.push(entry);
  }
  return entries;
}

Deno.test("DenoKvContentRepository: state is shared outside repository instances", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const writer: ContentRepository = new DenoKvContentRepository(kv);
    const page = page_with_md("shared");
    await writer.put(page);

    const reader: ContentRepository = new DenoKvContentRepository(kv);
    assertEquals(
      await reader.get({ namespace: "myns", page_name: "mypage" }),
      page,
    );
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvContentRepository: envelope and chunk layout separates data from metadata", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvContentRepository(kv);
    await repository.put(page_with_md("layout"));

    const stored_json = JSON.stringify({
      md: "layout",
      html: "<p>layout</p>",
    });
    const envelope = await kv.get<Record<string, unknown>>([
      "iam-pager",
      "content-pages",
      "by-locator",
      "myns/mypage",
    ]);
    assert(envelope.versionstamp !== null);
    const generation = envelope.value?.generation;
    assert(typeof generation === "string");
    assertEquals(envelope.value, {
      schema_version: 1,
      namespace: "MyNs",
      page_name: "MyPage",
      content_type: "md-page",
      media_type: "text/html; charset=utf-8",
      size_bytes: 6,
      created_at: "2026-07-18T00:00:00.000Z",
      updated_at: "2026-07-18T12:00:00.000Z",
      data_encoding: "json",
      generation,
      chunk_count: 1,
      data_byte_length: stored_json.length,
    });

    const chunks = await chunk_entries(kv);
    assertEquals(chunks.length, 1);
    assertEquals(chunks[0].key, [
      "iam-pager",
      "content-pages",
      "chunks",
      "myns/mypage",
      generation,
      0,
    ]);
    assertEquals(
      new TextDecoder().decode(chunks[0].value as Uint8Array),
      stored_json,
    );
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvContentRepository: data at exact chunk boundaries splits and reassembles", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvContentRepository(kv);
    // JSON envelope overhead around the md value, measured, not guessed.
    const overhead = JSON.stringify({ md: "", html: "" }).length;
    for (
      const total of [
        content_chunk_byte_length,
        content_chunk_byte_length + 1,
        3 * content_chunk_byte_length,
      ]
    ) {
      const page: PageRecord = {
        locator: { namespace: "chunky" },
        content: {
          content_type: "md-page",
          data: { md: "x".repeat(total - overhead), html: "" },
          meta: { media_type: "text/html; charset=utf-8", size_bytes: total },
          created_at: new Date("2026-07-18T00:00:00.000Z"),
          updated_at: new Date("2026-07-18T00:00:00.000Z"),
        },
      };
      await repository.put(page);
      assertEquals(await repository.get({ namespace: "chunky" }), page);
      const chunks = await chunk_entries(kv);
      assertEquals(chunks.length, Math.ceil(total / content_chunk_byte_length));
      for (const entry of chunks) {
        assert((entry.value as Uint8Array).length <= content_chunk_byte_length);
      }
    }
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvContentRepository: replacement leaves no chunks of prior generations", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvContentRepository(kv);
    await repository.put(
      page_with_md("g".repeat(3 * content_chunk_byte_length)),
    );
    assertEquals((await chunk_entries(kv)).length, 7);

    await repository.put(page_with_md("small"));
    const chunks = await chunk_entries(kv);
    assertEquals(chunks.length, 1);
    const envelope = await kv.get<{ generation: string }>([
      "iam-pager",
      "content-pages",
      "by-locator",
      "myns/mypage",
    ]);
    assertEquals(chunks[0].key[4], envelope.value?.generation);
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvContentRepository: delete removes the envelope and every chunk", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvContentRepository(kv);
    await repository.put(
      page_with_md("d".repeat(2 * content_chunk_byte_length)),
    );
    assertEquals(
      await repository.delete({ namespace: "MYNS", page_name: "MYPAGE" }),
      true,
    );

    assertEquals(await chunk_entries(kv), []);
    const envelope = await kv.get([
      "iam-pager",
      "content-pages",
      "by-locator",
      "myns/mypage",
    ]);
    assertEquals(envelope.versionstamp, null);
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvContentRepository: rejects data that JSON cannot represent", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvContentRepository(kv);
    const page = page_with_md("valid");
    await assertRejects(
      () =>
        repository.put({
          ...page,
          content: { ...page.content, data: undefined },
        }),
      TypeError,
      "JSON-serializable",
    );
    await assertRejects(
      () => repository.put({ ...page, content: { ...page.content, data: 1n } }),
      TypeError,
    );
    assertEquals(await chunk_entries(kv), []);
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvContentRepository: invalid stored envelopes are rejected, not misread", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvContentRepository(kv);
    const key = ["iam-pager", "content-pages", "by-locator", "broken"];
    for (
      const value of [
        null,
        "text",
        { schema_version: 2 },
        {
          schema_version: 1,
          namespace: "broken",
          content_type: "md-page",
          media_type: "text/html",
          size_bytes: 1,
          created_at: "not-a-date",
          updated_at: "2026-07-18T00:00:00.000Z",
          data_encoding: "json",
          generation: "g",
          chunk_count: 1,
          data_byte_length: 1,
        },
      ]
    ) {
      await kv.set(key, value);
      await assertRejects(
        () => repository.get({ namespace: "broken" }),
        TypeError,
        "invalid stored content page",
      );
    }
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvContentRepository: missing chunks of an unchanged envelope are corruption", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvContentRepository(kv);
    await repository.put(page_with_md("gone"));
    const [chunk] = await chunk_entries(kv);
    await kv.delete(chunk.key);
    await assertRejects(
      () => repository.get({ namespace: "myns", page_name: "mypage" }),
      TypeError,
      "invalid stored content page",
    );
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvContentRepository: concurrent replacements across instances leak nothing", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repositories = [
      new DenoKvContentRepository(kv),
      new DenoKvContentRepository(kv),
      new DenoKvContentRepository(kv),
    ];
    await Promise.all(
      repositories.map((repository, index) =>
        repository.put(
          make_conformance_page(
            "race",
            "page",
            String(index).repeat(2 * content_chunk_byte_length),
          ),
        )
      ),
    );
    const found = await repositories[0].get({
      namespace: "race",
      page_name: "page",
    });
    assert(found !== null);
    const envelope = await kv.get<{ generation: string; chunk_count: number }>([
      "iam-pager",
      "content-pages",
      "by-locator",
      "race/page",
    ]);
    const chunks = await chunk_entries(kv);
    // Only the winning generation's chunks remain after all flips settle.
    assertEquals(chunks.length, envelope.value?.chunk_count);
    for (const entry of chunks) {
      assertEquals(entry.key[4], envelope.value?.generation);
    }
  } finally {
    kv.close();
  }
});
