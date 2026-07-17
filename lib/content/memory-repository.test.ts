import { assertEquals } from "@std/assert";
import { MemoryContentRepository } from "./memory-repository.ts";
import type { PageRecord } from "./model.ts";

function make_page(
  namespace: string,
  page_name: string | undefined,
  marker: string,
): PageRecord {
  return {
    locator: page_name === undefined ? { namespace } : { namespace, page_name },
    content: {
      content_type: "md-page",
      data: { md: marker },
      meta: { media_type: "text/html; charset=utf-8", size_bytes: 0 },
      created_at: new Date(0),
      updated_at: new Date(0),
    },
  };
}

Deno.test("get of an unknown locator returns null", async () => {
  const repo = new MemoryContentRepository();
  assertEquals(await repo.get({ namespace: "ns" }), null);
});

Deno.test("lookup is case-insensitive, stored casing is preserved", async () => {
  const repo = new MemoryContentRepository();
  await repo.put(make_page("MyNs", "MyPage", "v1"));
  const found = await repo.get({ namespace: "myns", page_name: "mypage" });
  assertEquals(found?.locator, { namespace: "MyNs", page_name: "MyPage" });
});

Deno.test("put replaces the page at the same case-insensitive locator", async () => {
  const repo = new MemoryContentRepository();
  await repo.put(make_page("ns", "page", "v1"));
  await repo.put(make_page("NS", "PAGE", "v2"));
  const found = await repo.get({ namespace: "ns", page_name: "page" });
  assertEquals(found?.content.data, { md: "v2" });
  assertEquals(found?.locator, { namespace: "NS", page_name: "PAGE" });
});

Deno.test("default page and named page do not collide", async () => {
  const repo = new MemoryContentRepository();
  await repo.put(make_page("ns", undefined, "default"));
  await repo.put(make_page("ns", "page", "named"));
  assertEquals(
    (await repo.get({ namespace: "ns" }))?.content.data,
    { md: "default" },
  );
  assertEquals(
    (await repo.get({ namespace: "ns", page_name: "page" }))?.content.data,
    { md: "named" },
  );
});

Deno.test("delete removes the page and reports whether it existed", async () => {
  const repo = new MemoryContentRepository();
  await repo.put(make_page("ns", "page", "v1"));
  assertEquals(await repo.delete({ namespace: "NS", page_name: "Page" }), true);
  assertEquals(await repo.get({ namespace: "ns", page_name: "page" }), null);
  assertEquals(
    await repo.delete({ namespace: "ns", page_name: "page" }),
    false,
  );
});
