import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { MdPageHandler } from "../content/md-page.ts";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import { MemoryNamespaceRepository } from "../namespace/memory-repository.ts";
import type { AuthenticatedSession, Session } from "../session/model.ts";
import type { PageClock, PageIdGenerator } from "./interfaces.ts";
import { MemoryPageRepository } from "./memory-repository.ts";
import { RepositoryNamespaceAuthorityResolver } from "./namespace-authority.ts";
import {
  page_request_max_bytes,
  PageHttpAdapter,
  type PageHttpRequestContext,
} from "./http.ts";
import { PageService } from "./service.ts";

const now = new Date("2026-07-19T12:00:00.000Z");
const csrf_token = "c".repeat(43);
const guest_session: Session = {
  kind: "guest",
  session_id: "guest-session",
  session_version: 1,
  created_at: now,
  last_seen_at: now,
  absolute_expires_at: new Date("2026-07-26T12:00:00.000Z"),
};
const owner_session: AuthenticatedSession = {
  ...guest_session,
  kind: "authenticated",
  session_id: "owner-session",
  session_version: 2,
  user_id: "owner-1",
  authenticated_at: now,
  idle_expires_at: new Date("2026-08-19T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-10-19T12:00:00.000Z"),
  csrf_token,
};
const other_session: AuthenticatedSession = {
  ...owner_session,
  session_id: "other-session",
  user_id: "other-1",
  csrf_token: "o".repeat(43),
};

class SequenceIds implements PageIdGenerator {
  #next = 0;
  generate(): string {
    return `page-${++this.#next}`;
  }
}

class AdvancingClock implements PageClock {
  #next = now.getTime();
  now(): Date {
    const value = new Date(this.#next);
    this.#next += 60_000;
    return value;
  }
}

async function make_fixture() {
  const namespaces = new MemoryNamespaceRepository();
  await namespaces.reserve({ namespace: "Mine", owner_user_id: "owner-1" });
  await namespaces.reserve({ namespace: "Other", owner_user_id: "other-1" });
  const repository = new MemoryPageRepository();
  const engine = new LocatorEngine({
    strategies: [new PathSlugStrategy()],
    forbidden_namespaces: ["site", "api", "auth"],
  });
  const pages = new PageService({
    engine,
    repository,
    namespace_authority: new RepositoryNamespaceAuthorityResolver(namespaces),
    handlers: [new MdPageHandler()],
    page_id_generator: new SequenceIds(),
    clock: new AdvancingClock(),
  });
  return {
    adapter: new PageHttpAdapter({ pages }),
    pages,
    repository,
  };
}

function context(session: Session): PageHttpRequestContext {
  return { request_id: "request-1", session };
}

function create_body(
  namespace = "Free",
  page_name: string | undefined = "notes/today",
  access = "public",
  md = "# Page",
) {
  return {
    locator: page_name === undefined ? { namespace } : { namespace, page_name },
    access,
    content: { content_type: "md-page", input: { md } },
  };
}

function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: HeadersInit;
  } = {},
): Request {
  const headers = new Headers(options.headers);
  let body: string | undefined;
  if (options.body !== undefined) {
    body = typeof options.body === "string"
      ? options.body
      : JSON.stringify(options.body);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }
  return new Request(`https://pager.test${path}`, {
    method: options.method,
    headers,
    body,
  });
}

function creator_headers(etag?: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-csrf-token": csrf_token,
    ...(etag === undefined ? {} : { "if-match": etag }),
  };
}

async function create_managed_page(
  adapter: PageHttpAdapter,
  page_name = "notes",
  access = "private",
) {
  return await adapter.collection(
    request("/api/pages", {
      method: "POST",
      headers: creator_headers(),
      body: create_body("Mine", page_name, access),
    }),
    context(owner_session),
  );
}

Deno.test("page HTTP creates and replaces bounded guest trials", async () => {
  const { adapter } = await make_fixture();
  const first = await adapter.collection(
    request("/api/pages", { method: "POST", body: create_body() }),
    context(guest_session),
  );
  assertEquals(first.status, 201);
  assertEquals(first.headers.get("location"), "/Free/notes/today");
  assertEquals(first.headers.get("etag"), null);
  assertEquals(first.headers.get("cache-control"), "no-store");
  const first_body = await first.json();
  assertEquals(first_body.outcome, "created");
  assertEquals(first_body.path, "/Free/notes/today");
  assertEquals(first_body.url, "https://pager.test/Free/notes/today");
  assertEquals("management_url" in first_body, false);
  assertEquals("owner_user_id" in first_body.page, false);

  const replaced = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      body: create_body("FREE", "NOTES/TODAY", "public", "# New"),
    }),
    context(guest_session),
  );
  assertEquals(replaced.status, 200);
  assertEquals((await replaced.json()).outcome, "replaced");

  const private_trial = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      body: create_body("Free", undefined, "private"),
    }),
    context(guest_session),
  );
  assertEquals(private_trial.status, 403);
  assertEquals(
    (await private_trial.json()).error,
    "private_requires_managed_page",
  );
});

Deno.test("page HTTP prevents stale creator intent from becoming a trial", async () => {
  const { adapter, repository } = await make_fixture();
  const stale = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      headers: { "x-csrf-token": csrf_token },
      body: create_body("Free", undefined),
    }),
    context(guest_session),
  );
  assertEquals(stale.status, 401);
  assertEquals((await stale.json()).error, "not_authenticated");
  assertEquals(await repository.find_by_locator({ namespace: "Free" }), null);
});

Deno.test("page HTTP managed create requires CSRF and presents management identity", async () => {
  const { adapter } = await make_fixture();
  for (const token of [undefined, "wrong"]) {
    const response = await adapter.collection(
      request("/api/pages", {
        method: "POST",
        headers: token === undefined ? {} : { "x-csrf-token": token },
        body: create_body("Mine", "private", "private"),
      }),
      context(owner_session),
    );
    assertEquals(response.status, 403);
    assertEquals((await response.json()).error, "invalid_csrf");
  }

  const response = await create_managed_page(adapter);
  assertEquals(response.status, 201);
  assertEquals(response.headers.get("etag"), '"page-page-1-r1"');
  assertEquals(response.headers.get("location"), "/api/pages/page-1");
  const body = await response.json();
  assertEquals(body.outcome, "created");
  assertEquals(body.management_url, "/api/pages/page-1");
  assertEquals(body.page.access, "private");
  assertEquals(body.page.created_at, now.toISOString());
  assertEquals("owner_user_id" in body.page, false);

  const unreserved = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      headers: creator_headers(),
      body: create_body("Free", undefined),
    }),
    context(owner_session),
  );
  assertEquals(unreserved.status, 409);
  assertEquals((await unreserved.json()).error, "namespace_not_reserved");
});

Deno.test("page HTTP create decoding is strict, typed, and bounded", async () => {
  const { adapter } = await make_fixture();
  const cases: readonly [Request, number, string][] = [
    [
      request("/api/pages", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "no",
      }),
      415,
      "unsupported_media_type",
    ],
    [
      request("/api/pages", { method: "POST", body: "{bad" }),
      400,
      "invalid_json",
    ],
    [
      request("/api/pages", { method: "POST", body: [] }),
      400,
      "invalid_request",
    ],
    [
      request("/api/pages", {
        method: "POST",
        body: { ...create_body(), owner_user_id: "forged" },
      }),
      400,
      "invalid_request",
    ],
    [
      request("/api/pages", {
        method: "POST",
        body: {
          ...create_body(),
          locator: { namespace: "Free", surprise: true },
        },
      }),
      400,
      "invalid_request",
    ],
    [
      request("/api/pages", {
        method: "POST",
        body: { ...create_body(), access: "friends" },
      }),
      422,
      "invalid_access",
    ],
    [
      request("/api/pages", {
        method: "POST",
        body: {
          ...create_body(),
          content: { content_type: "retired", input: {} },
        },
      }),
      422,
      "unknown_content_type",
    ],
  ];
  for (const [input, status, error] of cases) {
    const response = await adapter.collection(input, context(guest_session));
    assertEquals(response.status, status);
    assertEquals((await response.json()).error, error);
  }

  const oversized = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      body: "x".repeat(page_request_max_bytes + 1),
    }),
    context(guest_session),
  );
  assertEquals(oversized.status, 413);
  assertEquals((await oversized.json()).error, "request_too_large");
});

Deno.test("page HTTP list is authenticated, owner-safe, paginated, and strict", async () => {
  const { adapter } = await make_fixture();
  await create_managed_page(adapter, "b", "public");
  await create_managed_page(adapter, "a", "private");

  const guest = await adapter.collection(
    request("/api/pages"),
    context(guest_session),
  );
  assertEquals(guest.status, 401);

  const first = await adapter.collection(
    request("/api/pages?namespace=Mine&limit=1"),
    context(owner_session),
  );
  assertEquals(first.status, 200);
  const first_body = await first.json();
  assertEquals(first_body.pages.length, 1);
  assertEquals(first_body.pages[0].locator.page_name, "a");
  assertEquals(first_body.pages[0].etag, '"page-page-2-r1"');
  assertEquals("content" in first_body.pages[0], false);
  assertEquals("owner_user_id" in first_body.pages[0], false);
  assert(typeof first_body.next_cursor === "string");

  const second = await adapter.collection(
    request(
      `/api/pages?namespace=Mine&limit=1&cursor=${first_body.next_cursor}`,
    ),
    context(owner_session),
  );
  assertEquals((await second.json()).pages[0].locator.page_name, "b");

  for (const query of ["limit=01", "limit=101", "limit=1&limit=2", "x=1"]) {
    const response = await adapter.collection(
      request(`/api/pages?${query}`),
      context(owner_session),
    );
    assertEquals(response.status, 400, query);
    assertEquals((await response.json()).error, "invalid_query");
  }
  const other_namespace = await adapter.collection(
    request("/api/pages?namespace=Other"),
    context(owner_session),
  );
  assertEquals(other_namespace.status, 404);
  assertEquals((await other_namespace.json()).error, "not_found");
});

Deno.test("page HTTP inspect returns editable source, ETag, and indistinguishable 404", async () => {
  const { adapter } = await make_fixture();
  await create_managed_page(adapter, "notes", "private");

  const response = await adapter.item(
    request("/api/pages/page-1"),
    context(owner_session),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("etag"), '"page-page-1-r1"');
  const body = await response.json();
  assertEquals(body.page.content, {
    content_type: "md-page",
    input: { md: "# Page" },
  });
  assertEquals("html" in body.page.content.input, false);

  for (
    const [path, session] of [
      ["/api/pages/page-1", guest_session],
      ["/api/pages/page-1", other_session],
      ["/api/pages/missing", owner_session],
    ] as const
  ) {
    const denied = await adapter.item(request(path), context(session));
    assertEquals(denied.status, session.kind === "guest" ? 401 : 404);
    if (session.kind === "authenticated") {
      assertEquals((await denied.json()).error, "not_found");
    }
  }

  const invalid = await adapter.item(
    request("/api/pages/bad.id"),
    context(owner_session),
  );
  assertEquals(invalid.status, 400);
  assertEquals((await invalid.json()).error, "invalid_page_id");
});

Deno.test("page HTTP PATCH enforces CSRF, exact ETags, strict patches, and revisions", async () => {
  const { adapter } = await make_fixture();
  const created = await create_managed_page(adapter, "notes", "private");
  const etag = created.headers.get("etag")!;

  const missing_csrf = await adapter.item(
    request("/api/pages/page-1", {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": etag },
      body: { access: "public" },
    }),
    context(owner_session),
  );
  assertEquals(missing_csrf.status, 403);

  const missing_precondition = await adapter.item(
    request("/api/pages/page-1", {
      method: "PATCH",
      headers: creator_headers(),
      body: { access: "public" },
    }),
    context(owner_session),
  );
  assertEquals(missing_precondition.status, 428);

  for (const invalid_etag of ["*", 'W/"page-page-1-r1"', '"page-page-1-r01"']) {
    const response = await adapter.item(
      request("/api/pages/page-1", {
        method: "PATCH",
        headers: creator_headers(invalid_etag),
        body: { access: "public" },
      }),
      context(owner_session),
    );
    assertEquals(response.status, 400, invalid_etag);
  }

  const wrong_page = await adapter.item(
    request("/api/pages/page-1", {
      method: "PATCH",
      headers: creator_headers('"page-other-r1"'),
      body: { access: "public" },
    }),
    context(owner_session),
  );
  assertEquals(wrong_page.status, 412);

  const updated = await adapter.item(
    request("/api/pages/page-1", {
      method: "PATCH",
      headers: creator_headers(etag),
      body: {
        access: "public",
        content: {
          content_type: "md-page",
          input: { md: "# Updated", css: "body { color: navy; }" },
        },
      },
    }),
    context(owner_session),
  );
  assertEquals(updated.status, 200);
  assertEquals(updated.headers.get("etag"), '"page-page-1-r2"');
  const updated_body = await updated.json();
  assertEquals(updated_body.page.access, "public");
  assertEquals(updated_body.page.revision, 2);
  assertEquals(updated_body.page.content.input.md, "# Updated");

  const stale = await adapter.item(
    request("/api/pages/page-1", {
      method: "PATCH",
      headers: creator_headers(etag),
      body: { access: "private" },
    }),
    context(owner_session),
  );
  assertEquals(stale.status, 412);
  assertEquals((await stale.json()).error, "precondition_failed");

  for (const body of [{}, { unknown: true }, { access: 7 }]) {
    const response = await adapter.item(
      request("/api/pages/page-1", {
        method: "PATCH",
        headers: creator_headers('"page-page-1-r2"'),
        body,
      }),
      context(owner_session),
    );
    assertEquals(response.status, 400);
  }
});

Deno.test("page HTTP DELETE is revision-bound, bodyless, and final", async () => {
  const { adapter } = await make_fixture();
  const created = await create_managed_page(adapter, "delete-me", "public");
  const etag = created.headers.get("etag")!;

  const with_body = await adapter.item(
    request("/api/pages/page-1", {
      method: "DELETE",
      headers: creator_headers(etag),
      body: {},
    }),
    context(owner_session),
  );
  assertEquals(with_body.status, 400);

  // Deno's live HTTP transport can expose a zero-byte body stream even when
  // the client sent no payload. Treat that as bodyless while rejecting bytes.
  const deleted = await adapter.item(
    request("/api/pages/page-1", {
      method: "DELETE",
      headers: { "x-csrf-token": csrf_token, "if-match": etag },
      body: "",
    }),
    context(owner_session),
  );
  assertEquals(deleted.status, 204);
  assertEquals(deleted.headers.get("cache-control"), "no-store");
  assertEquals(await deleted.text(), "");

  const repeated = await adapter.item(
    request("/api/pages/page-1", {
      method: "DELETE",
      headers: { "x-csrf-token": csrf_token, "if-match": etag },
    }),
    context(owner_session),
  );
  assertEquals(repeated.status, 404);
  assertEquals((await repeated.json()).error, "not_found");
});

Deno.test("page HTTP rejects unsupported methods with no-store Allow responses", async () => {
  const { adapter } = await make_fixture();
  const collection = await adapter.collection(
    request("/api/pages", { method: "PUT", body: {} }),
    context(guest_session),
  );
  assertEquals(collection.status, 405);
  assertEquals(collection.headers.get("allow"), "GET, POST");
  assertEquals(collection.headers.get("cache-control"), "no-store");

  const item = await adapter.item(
    request("/api/pages/page-1", { method: "POST", body: {} }),
    context(owner_session),
  );
  assertEquals(item.status, 405);
  assertEquals(item.headers.get("allow"), "GET, PATCH, DELETE");
  assertStringIncludes(await item.text(), "method_not_allowed");
});
