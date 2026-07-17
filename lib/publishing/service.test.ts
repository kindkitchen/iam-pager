import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import { MdPageHandler } from "../content/md-page.ts";
import type { MdPageData } from "../content/md-page.ts";
import { MemoryContentRepository } from "../content/memory-repository.ts";
import { PublishingService } from "./service.ts";

function make_service(now?: () => Date) {
  const repository = new MemoryContentRepository();
  const service = new PublishingService({
    engine: new LocatorEngine({
      strategies: [new PathSlugStrategy()],
      forbidden_namespaces: ["site"],
    }),
    repository,
    handlers: [new MdPageHandler()],
    now,
  });
  return { service, repository };
}

Deno.test("publish stores the page and returns its public path", async () => {
  const { service, repository } = make_service();
  const locator = { namespace: "Alice", page_name: "notes/today" };
  const result = await service.publish({
    locator,
    content_type: "md-page",
    input: { md: "# Hello" },
  });
  assert(result.ok);
  assertEquals(result.path, "/Alice/notes/today");
  assertEquals(result.page.locator, locator);
  const stored = await repository.get(locator);
  assertEquals(stored, result.page);
});

Deno.test("publish computes meta from the deterministic render output", async () => {
  const { service } = make_service();
  const result = await service.publish({
    locator: { namespace: "alice" },
    content_type: "md-page",
    input: { md: "# Hi" },
  });
  assert(result.ok);
  const payload = new MdPageHandler().render(
    result.page.content.data as MdPageData,
  );
  assertEquals(result.page.content.meta.media_type, payload.media_type);
  assertEquals(
    result.page.content.meta.size_bytes,
    new TextEncoder().encode(payload.body as string).byteLength,
  );
});

Deno.test("publish always runs validate -> derive: stored html is sanitized", async () => {
  const { service, repository } = make_service();
  await service.publish({
    locator: { namespace: "alice", page_name: "attack" },
    content_type: "md-page",
    input: { md: "hi <script>alert(1)</script>" },
  });
  const stored = await repository.get({
    namespace: "alice",
    page_name: "attack",
  });
  assert(stored !== null);
  assertFalse((stored.content.data as MdPageData).html.includes("<script>"));
});

Deno.test("publish rejects a forbidden namespace and stores nothing", async () => {
  const { service, repository } = make_service();
  const result = await service.publish({
    locator: { namespace: "Site", page_name: "x" },
    content_type: "md-page",
    input: { md: "# Hi" },
  });
  assertFalse(result.ok);
  assertEquals(result.reason, "forbidden_namespace");
  assertEquals(
    await repository.get({ namespace: "Site", page_name: "x" }),
    null,
  );
});

Deno.test("publish rejects an unknown content type", async () => {
  const { service } = make_service();
  const result = await service.publish({
    locator: { namespace: "alice" },
    content_type: "no-such-type",
    input: {},
  });
  assertFalse(result.ok);
  assertEquals(result.reason, "unknown_content_type");
});

Deno.test("publish surfaces the handler's validation reason and stores nothing", async () => {
  const { service, repository } = make_service();
  const result = await service.publish({
    locator: { namespace: "alice" },
    content_type: "md-page",
    input: { md: "" },
  });
  assertFalse(result.ok);
  assertEquals(result.reason, "invalid_input");
  assert(result.reason !== "invalid_input" || result.detail.length > 0);
  assertEquals(await repository.get({ namespace: "alice" }), null);
});

Deno.test("republish keeps created_at and refreshes updated_at", async () => {
  let tick = 0;
  const { service } = make_service(() => new Date(2026, 6, 18, 12, tick++));
  const locator = { namespace: "alice", page_name: "notes" };
  const first = await service.publish({
    locator,
    content_type: "md-page",
    input: { md: "v1" },
  });
  const second = await service.publish({
    locator: { namespace: "ALICE", page_name: "Notes" },
    content_type: "md-page",
    input: { md: "v2" },
  });
  assert(first.ok && second.ok);
  assertEquals(
    second.page.content.created_at,
    first.page.content.created_at,
  );
  assert(second.page.content.updated_at > first.page.content.updated_at);
});

Deno.test("deliver returns the rendered payload for a stored page", async () => {
  const { service } = make_service();
  await service.publish({
    locator: { namespace: "alice", page_name: "notes" },
    content_type: "md-page",
    input: { md: "# Hello" },
  });
  const result = await service.deliver({
    namespace: "ALICE",
    page_name: "Notes",
  });
  assert(result.ok);
  assert((result.payload.body as string).includes("<h1"));
  assertEquals(result.payload.media_type, result.page.content.meta.media_type);
  assertEquals(
    new TextEncoder().encode(result.payload.body as string).byteLength,
    result.page.content.meta.size_bytes,
  );
});

Deno.test("deliver reports not_found for an unknown locator", async () => {
  const { service } = make_service();
  const result = await service.deliver({ namespace: "nobody" });
  assertFalse(result.ok);
  assertEquals(result.reason, "not_found");
});

Deno.test("deliver reports unknown_content_type for an orphaned record", async () => {
  const { service, repository } = make_service();
  const now = new Date();
  await repository.put({
    locator: { namespace: "alice" },
    content: {
      content_type: "retired-type",
      data: {},
      meta: { media_type: "text/plain", size_bytes: 0 },
      created_at: now,
      updated_at: now,
    },
  });
  const result = await service.deliver({ namespace: "alice" });
  assertFalse(result.ok);
  assertEquals(result.reason, "unknown_content_type");
});

Deno.test("constructor rejects duplicate content types", () => {
  assertThrows(
    () =>
      new PublishingService({
        engine: new LocatorEngine({ strategies: [new PathSlugStrategy()] }),
        repository: new MemoryContentRepository(),
        handlers: [new MdPageHandler(), new MdPageHandler()],
      }),
    Error,
    "duplicate content type",
  );
});
