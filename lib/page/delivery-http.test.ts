import { assertEquals, assertStringIncludes } from "@std/assert";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import type { Session } from "../session/model.ts";
import {
  deliver_page_locator_path,
  page_actor_from_session,
} from "./delivery-http.ts";
import type { DeliverPageResult, PageDeliverer } from "./interfaces.ts";
Deno.test("direct delivery actor derives only from resolved session authority", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const guest: Session = {
    kind: "guest",
    session_id: "guest-session",
    session_version: 1,
    created_at: now,
    last_seen_at: now,
    absolute_expires_at: new Date("2026-07-26T12:00:00.000Z"),
  };
  const creator: Session = {
    ...guest,
    kind: "authenticated",
    user_id: "owner-1",
    authenticated_at: now,
    idle_expires_at: new Date("2026-08-18T12:00:00.000Z"),
    csrf_token: "c".repeat(43),
  };

  assertEquals(page_actor_from_session(guest), { kind: "guest" });
  assertEquals(page_actor_from_session(creator), {
    kind: "user",
    user_id: "owner-1",
  });
});

const engine = new LocatorEngine({
  strategies: [new PathSlugStrategy()],
  forbidden_namespaces: ["site"],
});
const guest_actor = { kind: "guest" } as const;

function page_with_size(size_bytes: number) {
  return { page_id: "page-1", revision: 1, size_bytes };
}

function fixed_deliverer(result: DeliverPageResult): PageDeliverer {
  return { deliver: () => Promise.resolve(result) };
}

function delivery_endpoint(delivery_profile = "inline") {
  return {
    locator: { namespace: "Ada", page_name: "notes" },
    path: "/Ada/notes",
    delivery_profile,
  } as const;
}

Deno.test("direct delivery maps active content to intentional isolated headers", async () => {
  const body = "<h1>Hello</h1>";
  const response = await deliver_page_locator_path(
    engine,
    fixed_deliverer({
      ok: true,
      page: page_with_size(new TextEncoder().encode(body).byteLength),
      endpoint: delivery_endpoint(),
      payload: { body, media_type: "text/html; charset=utf-8" },
    }),
    "/ada/notes",
    guest_actor,
  );

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  assertEquals(response.headers.get("content-length"), "14");
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("content-disposition"), "inline");
  assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  assertEquals(
    response.headers.get("content-security-policy"),
    "sandbox; default-src 'none'; img-src https: data:; " +
      "style-src 'unsafe-inline'",
  );
  assertStringIncludes(await response.text(), "Hello");
});

Deno.test("direct delivery encodes attachment filenames without active isolation", async () => {
  const response = await deliver_page_locator_path(
    engine,
    fixed_deliverer({
      ok: true,
      page: page_with_size(7),
      endpoint: delivery_endpoint("attachment"),
      payload: {
        body: "payload",
        media_type: "text/plain; charset=utf-8",
        download_filename: "notes détaillées.txt",
      },
    }),
    "/ada/notes",
    guest_actor,
  );

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-security-policy"), null);
  assertEquals(
    response.headers.get("content-disposition"),
    `attachment; filename="notes d_taill_es.txt"; ` +
      `filename*=UTF-8''notes%20d%C3%A9taill%C3%A9es.txt`,
  );
  await response.body?.cancel();
});

Deno.test("direct delivery disposition follows the endpoint rather than filename hints", async () => {
  const inline = await deliver_page_locator_path(
    engine,
    fixed_deliverer({
      ok: true,
      page: page_with_size(7),
      endpoint: delivery_endpoint("inline"),
      payload: {
        body: "payload",
        media_type: "application/octet-stream",
        download_filename: "suggested.bin",
      },
    }),
    "/ada/notes",
    guest_actor,
  );
  assertEquals(inline.headers.get("content-disposition"), "inline");
  await inline.body?.cancel();

  const unnamed_attachment = await deliver_page_locator_path(
    engine,
    fixed_deliverer({
      ok: true,
      page: page_with_size(7),
      endpoint: delivery_endpoint("attachment"),
      payload: { body: "payload", media_type: "application/octet-stream" },
    }),
    "/ada/notes",
    guest_actor,
  );
  assertEquals(
    unnamed_attachment.headers.get("content-disposition"),
    "attachment",
  );
  await unnamed_attachment.body?.cancel();
});

Deno.test("direct delivery fails explicitly for a transport-unknown profile", async () => {
  const response = await deliver_page_locator_path(
    engine,
    fixed_deliverer({
      ok: true,
      page: page_with_size(7),
      endpoint: delivery_endpoint("stream"),
      payload: { body: "payload", media_type: "application/octet-stream" },
    }),
    "/ada/notes",
    guest_actor,
  );
  assertEquals(response.status, 501);
  assertStringIncludes(await response.text(), "not supported");
});

Deno.test("direct PDF delivery supports validators and strict single byte ranges", async () => {
  const body = new TextEncoder().encode("0123456789");
  const result: DeliverPageResult = {
    ok: true,
    page: page_with_size(body.byteLength),
    endpoint: delivery_endpoint("attachment"),
    payload: {
      body,
      media_type: "application/pdf",
      download_filename: "report.pdf",
    },
  };
  const full = await deliver_page_locator_path(
    engine,
    fixed_deliverer(result),
    new Request("https://pager.test/ada/notes"),
    guest_actor,
    "request-1",
  );
  const etag = full.headers.get("etag")!;
  assertEquals(full.status, 200);
  assertEquals(full.headers.get("accept-ranges"), "bytes");
  assertEquals(full.headers.get("x-request-id"), "request-1");
  assertEquals(new Uint8Array(await full.arrayBuffer()), body);

  const partial = await deliver_page_locator_path(
    engine,
    fixed_deliverer(result),
    new Request("https://pager.test/ada/notes", {
      headers: { range: "bytes=2-5", "if-range": etag },
    }),
    guest_actor,
  );
  assertEquals(partial.status, 206);
  assertEquals(partial.headers.get("content-range"), "bytes 2-5/10");
  assertEquals(partial.headers.get("content-length"), "4");
  assertEquals(await partial.text(), "2345");

  for (const range of ["bytes=10-", "bytes=5-2", "bytes=0-1,4-5"]) {
    const rejected = await deliver_page_locator_path(
      engine,
      fixed_deliverer(result),
      new Request("https://pager.test/ada/notes", { headers: { range } }),
      guest_actor,
    );
    assertEquals(rejected.status, 416, range);
    assertEquals(rejected.headers.get("content-range"), "bytes */10");
    await rejected.body?.cancel();
  }

  const changed_if_range = await deliver_page_locator_path(
    engine,
    fixed_deliverer(result),
    new Request("https://pager.test/ada/notes", {
      headers: { range: "bytes=0-1", "if-range": '"other"' },
    }),
    guest_actor,
  );
  assertEquals(changed_if_range.status, 200);
  assertEquals(await changed_if_range.text(), "0123456789");

  const not_modified = await deliver_page_locator_path(
    engine,
    fixed_deliverer(result),
    new Request("https://pager.test/ada/notes", {
      headers: { "if-none-match": etag },
    }),
    guest_actor,
  );
  assertEquals(not_modified.status, 304);
  assertEquals(not_modified.headers.get("etag"), etag);
  assertEquals(await not_modified.text(), "");
});

Deno.test("direct delivery keeps invalid, missing, and undeliverable outcomes explicit", async () => {
  const missing = fixed_deliverer({ ok: false, reason: "not_found" });
  for (
    const [path, status] of [
      ["/ada/%zz", 400],
      ["/", 404],
      ["/site/page", 404],
      ["/nobody/here", 404],
    ] as const
  ) {
    const response = await deliver_page_locator_path(
      engine,
      missing,
      path,
      guest_actor,
    );
    assertEquals(response.status, status);
    await response.body?.cancel();
  }

  const undeliverable = await deliver_page_locator_path(
    engine,
    fixed_deliverer({ ok: false, reason: "corrupt" }),
    "/ada/notes",
    guest_actor,
  );
  assertEquals(undeliverable.status, 500);
  await undeliverable.body?.cancel();
});
