import { assertEquals, assertStringIncludes } from "@std/assert";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import type {
  ContentResult,
  ContentTypeHandler,
} from "../content/interfaces.ts";
import { MdPageHandler } from "../content/md-page.ts";
import { MemoryContentRepository } from "../content/memory-repository.ts";
import { PublishingService } from "./service.ts";
import { deliver_locator_path } from "./http.ts";

/** Text type that always asks for a download, to exercise disposition. */
const download_handler: ContentTypeHandler<string, string> = {
  content_type: "test-download",
  validate(input: unknown): ContentResult<string> {
    return typeof input === "string"
      ? { ok: true, value: input }
      : { ok: false, reason: "string required" };
  },
  derive: (input) => input,
  to_input: (data) => data,
  render: (data) => ({
    body: data,
    media_type: "text/plain; charset=utf-8",
    download_filename: "notes détaillées.txt",
  }),
};

function make_fixture() {
  const engine = new LocatorEngine({
    strategies: [new PathSlugStrategy()],
    forbidden_namespaces: ["site"],
  });
  const repository = new MemoryContentRepository();
  const service = new PublishingService({
    engine,
    repository,
    handlers: [new MdPageHandler(), download_handler],
  });
  return { engine, repository, service };
}

Deno.test("delivers a published md page with intentional headers", async () => {
  const { engine, service } = make_fixture();
  const published = await service.publish({
    locator: { namespace: "Ada", page_name: "notes" },
    content_type: "md-page",
    input: { md: "# Hello" },
  });
  assertEquals(published.ok, true);

  const response = await deliver_locator_path(engine, service, "/ada/notes");
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("content-disposition"), "inline");
  assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  assertEquals(
    response.headers.get("content-security-policy"),
    "sandbox; default-src 'none'; img-src https: data:; " +
      "style-src 'unsafe-inline'",
  );
  const body = await response.text();
  assertStringIncludes(body, "Hello");
  assertEquals(
    response.headers.get("content-length"),
    String(new TextEncoder().encode(body).byteLength),
  );
});

Deno.test("attachment disposition carries fallback and RFC 5987 filename", async () => {
  const { engine, service } = make_fixture();
  await service.publish({
    locator: { namespace: "ada", page_name: "dl" },
    content_type: "test-download",
    input: "payload",
  });

  const response = await deliver_locator_path(engine, service, "/ada/dl");
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-security-policy"), null);
  assertEquals(
    response.headers.get("content-disposition"),
    `attachment; filename="notes d_taill_es.txt"; ` +
      `filename*=UTF-8''notes%20d%C3%A9taill%C3%A9es.txt`,
  );
  await response.body?.cancel();
});

Deno.test("missing page responds 404", async () => {
  const { engine, service } = make_fixture();
  const response = await deliver_locator_path(engine, service, "/nobody/here");
  assertEquals(response.status, 404);
  await response.body?.cancel();
});

Deno.test("malformed segment responds 400, not a home page", async () => {
  const { engine, service } = make_fixture();
  const response = await deliver_locator_path(engine, service, "/ada/%zz");
  assertEquals(response.status, 400);
  await response.body?.cancel();
});

Deno.test("non-locator root path responds 404", async () => {
  const { engine, service } = make_fixture();
  const response = await deliver_locator_path(engine, service, "/");
  assertEquals(response.status, 404);
  await response.body?.cancel();
});

Deno.test("forbidden namespace responds 404 at the delivery boundary", async () => {
  const { engine, service } = make_fixture();
  const response = await deliver_locator_path(engine, service, "/site/x");
  assertEquals(response.status, 404);
  await response.body?.cancel();
});

Deno.test("stored content without a handler responds 500", async () => {
  const { engine, repository, service } = make_fixture();
  await repository.put({
    locator: { namespace: "ghost", page_name: "page" },
    content: {
      content_type: "vanished-type",
      data: {},
      meta: { media_type: "text/plain", size_bytes: 0 },
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  const response = await deliver_locator_path(engine, service, "/ghost/page");
  assertEquals(response.status, 500);
  await response.body?.cancel();
});
