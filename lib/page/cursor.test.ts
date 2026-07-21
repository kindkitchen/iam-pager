import { assert, assertEquals } from "@std/assert";
import {
  compare_page_sort_keys,
  decode_managed_page_list_cursor,
  decode_page_exploration_cursor,
  decode_page_list_cursor,
  encode_managed_page_list_cursor,
  encode_page_exploration_cursor,
  encode_page_list_cursor,
  max_page_list_cursor_length,
  page_sort_key,
  type PageSortKey,
} from "./cursor.ts";
function make_record(
  namespace: string,
  page_name: string | undefined,
  page_id: string,
) {
  return {
    page_id,
    locator: page_name === undefined ? { namespace } : { namespace, page_name },
  };
}

function base64url(text: string): string {
  return btoa(text)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

Deno.test("page_sort_key normalizes casing and ranks the default page first", () => {
  assertEquals(page_sort_key(make_record("Alice", undefined, "id-1")), {
    namespace_key: "alice",
    default_rank: 0,
    page_name_key: "",
    page_id: "id-1",
  });
  assertEquals(page_sort_key(make_record("ALICE", "Notes/Today", "id-2")), {
    namespace_key: "alice",
    default_rank: 1,
    page_name_key: "notes/today",
    page_id: "id-2",
  });
});

Deno.test("compare_page_sort_keys orders namespace, default, name, then id", () => {
  const ordered = [
    page_sort_key(make_record("alpha", undefined, "id-1")),
    page_sort_key(make_record("alpha", "a", "id-2")),
    page_sort_key(make_record("alpha", "a", "id-3")),
    page_sort_key(make_record("alpha", "b", "id-1")),
    page_sort_key(make_record("beta", undefined, "id-0")),
    page_sort_key(make_record("beta", "a", "id-0")),
  ];
  const shuffled = [...ordered].reverse();
  shuffled.sort(compare_page_sort_keys);
  assertEquals(shuffled, ordered);
  assertEquals(compare_page_sort_keys(ordered[0], ordered[0]), 0);
});

Deno.test("cursor round-trips with and without a namespace filter", () => {
  const key: PageSortKey = {
    namespace_key: "alice",
    default_rank: 1,
    page_name_key: "notes/today",
    page_id: "id-1",
  };
  for (const filter of [null, "alice"]) {
    const encoded = encode_page_list_cursor(key, filter);
    assert(encoded.length <= max_page_list_cursor_length);
    assert(/^[A-Za-z0-9_-]+$/.test(encoded));
    assertEquals(decode_page_list_cursor(encoded, filter), key);
  }
  const default_key: PageSortKey = {
    namespace_key: "alice",
    default_rank: 0,
    page_name_key: "",
    page_id: "id-2",
  };
  const encoded = encode_page_list_cursor(default_key, null);
  assertEquals(decode_page_list_cursor(encoded, null), default_key);
});

Deno.test("managed cursor binds every active filter", () => {
  const key: PageSortKey = {
    namespace_key: "alice",
    default_rank: 1,
    page_name_key: "notes",
    page_id: "id-1",
  };
  const scope = {
    namespace: "alice",
    page_name_query: "note",
    access: "public" as const,
    tag: "deno",
  };
  const encoded = encode_managed_page_list_cursor(key, scope);
  assertEquals(decode_managed_page_list_cursor(encoded, scope), key);
  assertEquals(
    decode_managed_page_list_cursor(encoded, { ...scope, tag: "news" }),
    null,
  );
  assertEquals(
    decode_managed_page_list_cursor(encoded, { ...scope, access: "private" }),
    null,
  );
});

Deno.test("exploration cursor binds the exact tag and name query scope", () => {
  const key: PageSortKey = {
    namespace_key: "alice",
    default_rank: 1,
    page_name_key: "notes",
    page_id: "id-1",
  };
  const scope = {
    namespace_query: "ali",
    page_name_query: "note",
    tag: "deno",
  };
  const encoded = encode_page_exploration_cursor(key, scope);
  assertEquals(decode_page_exploration_cursor(encoded, scope), key);
  assertEquals(
    decode_page_exploration_cursor(encoded, { ...scope, tag: null }),
    null,
  );
  assertEquals(decode_page_list_cursor(encoded, null), null);
});

Deno.test("decode rejects malformed or incoherent cursors", () => {
  const valid: PageSortKey = {
    namespace_key: "alice",
    default_rank: 1,
    page_name_key: "a",
    page_id: "id-1",
  };
  const payload = {
    namespace_key: "alice",
    default_rank: 1,
    page_name_key: "a",
    page_id: "id-1",
    filter: null,
  };
  const cases: { raw: string; filter: string | null }[] = [
    { raw: "", filter: null },
    { raw: "not base64url!", filter: null },
    { raw: "A".repeat(max_page_list_cursor_length + 1), filter: null },
    { raw: `${encode_page_list_cursor(valid, null)}=`, filter: null },
    { raw: base64url("not json"), filter: null },
    { raw: base64url("[1,2]"), filter: null },
    {
      raw: base64url(JSON.stringify({ namespace_key: "alice" })),
      filter: null,
    },
    {
      raw: base64url(JSON.stringify({ ...payload, extra: true })),
      filter: null,
    },
    {
      raw: base64url(JSON.stringify({ ...payload, namespace_key: "ALICE" })),
      filter: null,
    },
    {
      raw: base64url(JSON.stringify({ ...payload, default_rank: 2 })),
      filter: null,
    },
    {
      raw: base64url(
        JSON.stringify({ ...payload, default_rank: 0, page_name_key: "a" }),
      ),
      filter: null,
    },
    {
      raw: base64url(JSON.stringify({ ...payload, page_name_key: "" })),
      filter: null,
    },
    {
      raw: base64url(JSON.stringify({ ...payload, page_id: "bad id" })),
      filter: null,
    },
    // filter mismatches in both directions
    { raw: encode_page_list_cursor(valid, null), filter: "alice" },
    { raw: encode_page_list_cursor(valid, "alice"), filter: null },
    // cursor namespace must match the active filter
    {
      raw: base64url(
        JSON.stringify({ ...payload, namespace_key: "beta", filter: "alpha" }),
      ),
      filter: "alpha",
    },
  ];
  for (const { raw, filter } of cases) {
    assertEquals(
      decode_page_list_cursor(raw, filter),
      null,
      `must reject: ${raw.slice(0, 40)}`,
    );
  }
});
