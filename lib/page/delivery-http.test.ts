import { assertEquals, assertStringIncludes } from "@std/assert";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import type { Session } from "../session/model.ts";
import {
  deliver_page_locator_path,
  page_actor_from_session,
} from "./delivery-http.ts";
import type { DeliverPageResult, PageDeliverer } from "./interfaces.ts";
import type { PageRecord } from "./model.ts";

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

function page_with_meta(
  media_type: string,
  size_bytes: number,
): PageRecord {
  const now = new Date("2026-07-19T12:00:00.000Z");
  return {
    page_id: "page-1",
    locator: { namespace: "Ada", page_name: "notes" },
    stewardship: { kind: "trial" },
    access: "public",
    revision: 1,
    content: {
      content_type: "test",
      data: null,
      meta: { media_type, size_bytes },
    },
    created_at: now,
    updated_at: now,
  };
}

function fixed_deliverer(result: DeliverPageResult): PageDeliverer {
  return { deliver: () => Promise.resolve(result) };
}

Deno.test("direct delivery maps active content to intentional isolated headers", async () => {
  const body = "<h1>Hello</h1>";
  const response = await deliver_page_locator_path(
    engine,
    fixed_deliverer({
      ok: true,
      page: page_with_meta(
        "text/html; charset=utf-8",
        new TextEncoder().encode(body).byteLength,
      ),
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
      page: page_with_meta("text/plain; charset=utf-8", 7),
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
    fixed_deliverer({ ok: false, reason: "unknown_content_type" }),
    "/ada/notes",
    guest_actor,
  );
  assertEquals(undeliverable.status, 500);
  await undeliverable.body?.cancel();
});
