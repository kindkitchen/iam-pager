import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { BearerFirstApiRequestAuthenticator } from "../api-auth/mod.ts";
import type { ApiKeyBearerResolver, ApiKeyPrincipal } from "../api-key/mod.ts";
import type { ContentAsset } from "../content/asset.ts";
import { MdPageHandler } from "../content/md-page.ts";
import { PdfHandler } from "../content/pdf.ts";
import {
  ExternalStorageProviderRegistry,
  MemoryExternalStorageProvider,
} from "../external-storage/mod.ts";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import { MemoryNamespaceRepository } from "../namespace/memory-repository.ts";
import type { AuthenticatedSession, Session } from "../session/model.ts";
import type { PageClock, PageIdGenerator } from "./interfaces.ts";
import { MemoryPageAggregateRepository } from "./memory-aggregate-repository.ts";
import { RepositoryNamespaceAuthorityResolver } from "./namespace-authority.ts";
import {
  deliver_page_locator_path,
  page_request_max_bytes,
  PageHttpAdapter,
  type PageHttpRequestContext,
} from "./mod.ts";
import { PageService } from "./service.ts";

const now = new Date("2026-07-19T12:00:00.000Z");
const csrf_token = "c".repeat(43);
const text_encoder = new TextEncoder();

function pdf_bytes(marker = "fixture"): Uint8Array {
  const before_xref = `%PDF-1.7\n` +
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n` +
    `% ${marker}\n`;
  const xref_offset = text_encoder.encode(before_xref).byteLength;
  return text_encoder.encode(
    before_xref +
      `xref\n0 3\n` +
      `0000000000 65535 f \n` +
      `0000000009 00000 n \n` +
      `0000000062 00000 n \n` +
      `trailer\n<< /Size 3 /Root 1 0 R >>\n` +
      `startxref\n${xref_offset}\n%%EOF\n`,
  );
}
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

const bearer_principals: Record<string, ApiKeyPrincipal> = {
  "owner-all": {
    kind: "api_key",
    api_key_id: "key-all",
    user_id: "owner-1",
    permissions: ["read", "write", "delete"],
  },
  "owner-read": {
    kind: "api_key",
    api_key_id: "key-read",
    user_id: "owner-1",
    permissions: ["read"],
  },
  "owner-write": {
    kind: "api_key",
    api_key_id: "key-write",
    user_id: "owner-1",
    permissions: ["write"],
  },
  "other-all": {
    kind: "api_key",
    api_key_id: "key-other",
    user_id: "other-1",
    permissions: ["read", "write", "delete"],
  },
};

const bearer_resolver: ApiKeyBearerResolver = {
  resolve_bearer: (bearer) =>
    Promise.resolve(bearer_principals[bearer] ?? null),
};

function bearer_headers(token: string, etag?: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...(etag === undefined ? {} : { "if-match": etag }),
  };
}

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
  const repository = new MemoryPageAggregateRepository();
  const engine = new LocatorEngine({
    strategies: [new PathSlugStrategy()],
    forbidden_namespaces: ["site", "api", "auth"],
  });
  const external_provider = new MemoryExternalStorageProvider();
  const pages = new PageService({
    engine,
    repository,
    namespace_authority: new RepositoryNamespaceAuthorityResolver(namespaces),
    handlers: [new MdPageHandler(), new PdfHandler()],
    page_id_generator: new SequenceIds(),
    external_storage_providers: new ExternalStorageProviderRegistry([
      external_provider,
    ]),
    clock: new AdvancingClock(),
  });
  return {
    adapter: new PageHttpAdapter({
      pages,
      authenticator: new BearerFirstApiRequestAuthenticator({
        bearer_resolver,
      }),
    }),
    engine,
    pages,
    repository,
    external_provider,
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

function pdf_multipart_request(
  path: string,
  metadata: unknown,
  bytes: Uint8Array,
  options: {
    method?: string;
    etag?: string;
    filename?: string;
    file_media_type?: string;
    extra_part?: boolean;
  } = {},
): Request {
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    "metadata.json",
  );
  form.append(
    "file",
    new Blob([bytes as BlobPart], {
      type: options.file_media_type ?? "application/pdf",
    }),
    options.filename ?? "report.pdf",
  );
  if (options.extra_part) form.append("unexpected", "value");
  const request = new Request(`https://pager.test${path}`, {
    method: options.method ?? "POST",
    headers: {
      "x-csrf-token": csrf_token,
      ...(options.etag === undefined ? {} : { "if-match": options.etag }),
    },
    body: form,
  });
  return request;
}

function pdf_metadata(access: "public" | "private" = "public") {
  return {
    endpoint_set: {
      canonical: {
        locator: { namespace: "Mine", page_name: "report-preview" },
        delivery_profile: "inline",
      },
      alternates: [{
        locator: { namespace: "Mine", page_name: "report-download" },
        delivery_profile: "attachment",
      }],
    },
    access,
    tags: ["Reports"],
  };
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
  tags?: string[],
) {
  return await adapter.collection(
    request("/api/pages", {
      method: "POST",
      headers: creator_headers(),
      body: {
        ...create_body("Mine", page_name, access),
        ...(tags === undefined ? {} : { tags }),
      },
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
  assertEquals(first_body.page.endpoints, {
    canonical: {
      locator: { namespace: "Free", page_name: "notes/today" },
      path: "/Free/notes/today",
      delivery_profile: "inline",
    },
    alternates: [],
  });
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
  assertEquals(
    await repository.resolve_page_endpoint({ namespace: "Free" }),
    null,
  );
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
  assertEquals(body.page.endpoints.canonical.path, "/Mine/notes");
  assertEquals(body.page.endpoints.canonical.delivery_profile, "inline");
  assertEquals(body.page.endpoints.alternates, []);
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

Deno.test("page HTTP accepts explicit locator references for any content type", async () => {
  const { adapter } = await make_fixture();
  const created = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      headers: creator_headers(),
      body: {
        endpoint_set: {
          canonical: {
            locator: { namespace: "Mine", page_name: "article" },
            delivery_profile: "inline",
          },
          alternates: [{
            locator: { namespace: "Mine", page_name: "article-alias" },
            delivery_profile: "inline",
          }],
        },
        access: "public",
        content: {
          content_type: "md-page",
          input: { md: "# Article" },
        },
      },
    }),
    context(owner_session),
  );
  assertEquals(created.status, 201);
  const created_body = await created.json();
  assertEquals(
    created_body.page.endpoints.alternates[0].path,
    "/Mine/article-alias",
  );

  const changed = await adapter.item(
    request("/api/pages/page-1", {
      method: "PATCH",
      headers: creator_headers('"page-page-1-r1"'),
      body: {
        endpoint_set: {
          canonical: {
            locator: { namespace: "Mine", page_name: "article-primary" },
            delivery_profile: "inline",
          },
        },
      },
    }),
    context(owner_session),
  );
  assertEquals(changed.status, 200);
  const changed_body = await changed.json();
  assertEquals(changed_body.page.path, "/Mine/article-primary");
  assertEquals(changed_body.page.endpoints.alternates, []);
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

Deno.test("page HTTP create and PATCH carry bounded canonical tags", async () => {
  const { adapter } = await make_fixture();
  const created = await create_managed_page(adapter, "tagged", "public", [
    " Recipes ",
    "kitchen",
    "recipes",
  ]);
  assertEquals(created.status, 201);
  const created_body = await created.json();
  assertEquals(created_body.page.tags, ["kitchen", "recipes"]);

  const malformed = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      headers: creator_headers(),
      body: { ...create_body("Mine", "typed"), tags: [7] },
    }),
    context(owner_session),
  );
  assertEquals(malformed.status, 400);
  assertEquals((await malformed.json()).error, "invalid_request");

  const invalid = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      headers: creator_headers(),
      body: { ...create_body("Mine", "invalid"), tags: ["###"] },
    }),
    context(owner_session),
  );
  assertEquals(invalid.status, 422);
  assertEquals((await invalid.json()).error, "invalid_tags");

  const trial = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      body: { ...create_body(), tags: ["free"] },
    }),
    context(guest_session),
  );
  assertEquals(trial.status, 422);
  assertEquals((await trial.json()).error, "invalid_tags");

  const replaced = await adapter.item(
    request("/api/pages/page-1", {
      method: "PATCH",
      headers: creator_headers('"page-page-1-r1"'),
      body: { tags: ["Baking"] },
    }),
    context(owner_session),
  );
  assertEquals(replaced.status, 200);
  assertEquals((await replaced.json()).page.tags, ["baking"]);

  const cleared = await adapter.item(
    request("/api/pages/page-1", {
      method: "PATCH",
      headers: creator_headers('"page-page-1-r2"'),
      body: { tags: [] },
    }),
    context(owner_session),
  );
  assertEquals(cleared.status, 200);
  assertEquals((await cleared.json()).page.tags, []);
});

Deno.test("page HTTP list accepts name, access, and tag filters strictly", async () => {
  const { adapter } = await make_fixture();
  await create_managed_page(adapter, "soup-recipe", "public", ["kitchen"]);
  await create_managed_page(adapter, "draft-notes", "private", ["desk"]);

  const filtered = await adapter.collection(
    request("/api/pages?name=SOUP&access=public&tag=Kitchen"),
    context(owner_session),
  );
  assertEquals(filtered.status, 200);
  const filtered_body = await filtered.json();
  assertEquals(filtered_body.pages.length, 1);
  assertEquals(filtered_body.pages[0].locator.page_name, "soup-recipe");
  assertEquals(filtered_body.pages[0].tags, ["kitchen"]);

  const empty = await adapter.collection(
    request("/api/pages?access=public&tag=desk"),
    context(owner_session),
  );
  assertEquals((await empty.json()).pages.length, 0);

  for (
    const query of [
      "access=friends",
      "tag=%23%23%23",
      `name=${"x".repeat(101)}`,
    ]
  ) {
    const response = await adapter.collection(
      request(`/api/pages?${query}`),
      context(owner_session),
    );
    assertEquals(response.status, 400, query);
    assertEquals((await response.json()).error, "invalid_filter");
  }
});

Deno.test("page HTTP exposes, filters, and repairs external health", async () => {
  const { adapter, repository, external_provider } = await make_fixture();
  const body = text_encoder.encode("<!doctype html><h1>External</h1>");
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const old_ref = {
    provider_id: "memory",
    connection_id: "connection-1",
    external_ref: "old-object",
    version_hint: "version-1",
  } as const;
  const asset: ContentAsset = {
    content_asset_id: "external-http-asset",
    content_type: "md-page",
    source: { kind: "external", ref: old_ref },
    meta: {
      media_type: "text/html; charset=utf-8",
      size_bytes: body.byteLength,
      sha256: digest,
      codec_version: "md-page-html-v1",
    },
    created_at: now,
  };
  assert((await repository.create_content_asset(asset)).ok);
  const created = await repository.create_managed_page_aggregate({
    page_id: "external-http-page",
    endpoint_set: {
      canonical: {
        locator: { namespace: "Mine", page_name: "broken" },
        delivery_profile: "inline",
      },
      alternates: [],
    },
    owner_user_id: owner_session.user_id,
    access: "public",
    content_asset_id: asset.content_asset_id,
    now,
  });
  assert(created.ok);
  assert(
    (await repository.update_external_content_health({
      page_id: "external-http-page",
      content_asset_id: asset.content_asset_id,
      external_missing: {
        cause: "external_content_missing",
        detected_at: now,
      },
    })).ok,
  );
  external_provider.seed_content(old_ref, body);
  external_provider.seed_content(
    { ...old_ref, external_ref: "new-object" },
    body,
  );

  const inspected = await adapter.item(
    request("/api/pages/external-http-page"),
    context(owner_session),
  );
  assertEquals(inspected.status, 200);
  const inspected_body = await inspected.json();
  assertEquals(inspected_body.page.external_missing, {
    cause: "external_content_missing",
    detected_at: now.toISOString(),
  });
  assertEquals(inspected_body.page.content.external_source, {
    provider_id: "memory",
    external_ref: "old-object",
  });
  const filtered = await adapter.collection(
    request("/api/pages?external_missing=true"),
    context(owner_session),
  );
  assertEquals(filtered.status, 200);
  assertEquals((await filtered.json()).pages.length, 1);
  const invalid_filter = await adapter.collection(
    request("/api/pages?external_missing=yes"),
    context(owner_session),
  );
  assertEquals(invalid_filter.status, 400);

  const repaired = await adapter.item_action(
    request("/api/pages/external-http-page/relink", {
      method: "POST",
      headers: creator_headers('"page-external-http-page-r1"'),
      body: { external_ref: "new-object" },
    }),
    context(owner_session),
  );
  assertEquals(repaired.status, 200);
  const repaired_body = await repaired.json();
  assertEquals(repaired_body.outcome, "relinked");
  assertEquals(repaired_body.page.external_missing, undefined);
  assertEquals(repaired_body.page.revision, 2);
});

Deno.test("page HTTP rename is authenticated, revision-bound, and conflict-safe", async () => {
  const { adapter } = await make_fixture();
  await create_managed_page(adapter, "original", "public", ["kept"]);
  await create_managed_page(adapter, "occupied", "public");

  const missing_csrf = await adapter.item_action(
    request("/api/pages/page-1/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { page_name: "renamed" },
    }),
    context(owner_session),
  );
  assertEquals(missing_csrf.status, 403);

  const guest = await adapter.item_action(
    request("/api/pages/page-1/rename", {
      method: "POST",
      body: { page_name: "renamed" },
    }),
    context(guest_session),
  );
  assertEquals(guest.status, 401);

  const missing_precondition = await adapter.item_action(
    request("/api/pages/page-1/rename", {
      method: "POST",
      headers: creator_headers(),
      body: { page_name: "renamed" },
    }),
    context(owner_session),
  );
  assertEquals(missing_precondition.status, 428);

  const conflict = await adapter.item_action(
    request("/api/pages/page-1/rename", {
      method: "POST",
      headers: creator_headers('"page-page-1-r1"'),
      body: { page_name: "occupied" },
    }),
    context(owner_session),
  );
  assertEquals(conflict.status, 409);
  assertEquals((await conflict.json()).error, "page_exists");

  const invalid_name = await adapter.item_action(
    request("/api/pages/page-1/rename", {
      method: "POST",
      headers: creator_headers('"page-page-1-r1"'),
      body: { page_name: "nested/../escape" },
    }),
    context(owner_session),
  );
  assertEquals(invalid_name.status, 422);
  assertEquals((await invalid_name.json()).error, "invalid_page_name");

  const renamed = await adapter.item_action(
    request("/api/pages/page-1/rename", {
      method: "POST",
      headers: creator_headers('"page-page-1-r1"'),
      body: { page_name: "renamed" },
    }),
    context(owner_session),
  );
  assertEquals(renamed.status, 200);
  assertEquals(renamed.headers.get("etag"), '"page-page-1-r2"');
  const renamed_body = await renamed.json();
  assertEquals(renamed_body.outcome, "renamed");
  assertEquals(renamed_body.page.path, "/Mine/renamed");
  assertEquals(renamed_body.page.tags, ["kept"]);
  assertEquals(renamed_body.page.content.input.md, "# Page");

  const unchanged = await adapter.item_action(
    request("/api/pages/page-1/rename", {
      method: "POST",
      headers: creator_headers('"page-page-1-r2"'),
      body: { page_name: "renamed" },
    }),
    context(owner_session),
  );
  assertEquals(unchanged.status, 200);
  assertEquals((await unchanged.json()).outcome, "unchanged");

  const to_default = await adapter.item_action(
    request("/api/pages/page-1/rename", {
      method: "POST",
      headers: creator_headers('"page-page-1-r2"'),
      body: {},
    }),
    context(owner_session),
  );
  assertEquals(to_default.status, 200);
  const default_body = await to_default.json();
  assertEquals(default_body.page.locator, { namespace: "Mine" });
  assertEquals(default_body.page.path, "/Mine");

  const foreign = await adapter.item_action(
    request("/api/pages/page-1/rename", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": other_session.csrf_token,
        "if-match": '"page-page-1-r3"',
      },
      body: { page_name: "stolen" },
    }),
    context(other_session),
  );
  assertEquals(foreign.status, 404);
  assertEquals((await foreign.json()).error, "not_found");

  const unknown_action = await adapter.item_action(
    request("/api/pages/page-1/promote", {
      method: "POST",
      headers: creator_headers('"page-page-1-r3"'),
      body: {},
    }),
    context(owner_session),
  );
  assertEquals(unknown_action.status, 404);

  const wrong_method = await adapter.item_action(
    request("/api/pages/page-1/rename", { method: "GET" }),
    context(owner_session),
  );
  assertEquals(wrong_method.status, 405);
  assertEquals(wrong_method.headers.get("allow"), "POST");
});

Deno.test("page HTTP duplicate copies the source into a generated locator", async () => {
  const { adapter } = await make_fixture();
  await create_managed_page(adapter, "source", "private", ["copied"]);

  const with_body = await adapter.item_action(
    request("/api/pages/page-1/duplicate", {
      method: "POST",
      headers: creator_headers('"page-page-1-r1"'),
      body: {},
    }),
    context(owner_session),
  );
  assertEquals(with_body.status, 400);

  const stale = await adapter.item_action(
    request("/api/pages/page-1/duplicate", {
      method: "POST",
      headers: { "x-csrf-token": csrf_token, "if-match": '"page-page-1-r9"' },
    }),
    context(owner_session),
  );
  assertEquals(stale.status, 412);

  const duplicated = await adapter.item_action(
    request("/api/pages/page-1/duplicate", {
      method: "POST",
      headers: { "x-csrf-token": csrf_token, "if-match": '"page-page-1-r1"' },
    }),
    context(owner_session),
  );
  assertEquals(duplicated.status, 201);
  assertEquals(duplicated.headers.get("location"), "/api/pages/page-2");
  assertEquals(duplicated.headers.get("etag"), '"page-page-2-r1"');
  const body = await duplicated.json();
  assertEquals(body.outcome, "created");
  assertEquals(body.page.page_id, "page-2");
  assertEquals(body.page.locator.namespace, "Mine");
  assert(typeof body.page.locator.page_name === "string");
  assert(body.page.locator.page_name !== "source");
  assertEquals(body.page.access, "private");
  assertEquals(body.page.tags, ["copied"]);
  assertEquals(body.page.revision, 1);
  assertEquals(body.page.content.input.md, "# Page");

  const source = await adapter.item(
    request("/api/pages/page-1"),
    context(owner_session),
  );
  assertEquals((await source.json()).page.revision, 1);
});

Deno.test("page HTTP duplicate accepts explicit destination references", async () => {
  const { adapter } = await make_fixture();
  const source = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      headers: creator_headers(),
      body: {
        endpoint_set: {
          canonical: {
            locator: { namespace: "Mine", page_name: "source-primary" },
            delivery_profile: "inline",
          },
          alternates: [{
            locator: { namespace: "Mine", page_name: "source-alias" },
            delivery_profile: "inline",
          }],
        },
        access: "private",
        content: { content_type: "md-page", input: { md: "# Source" } },
      },
    }),
    context(owner_session),
  );
  assertEquals(source.status, 201);

  const duplicated = await adapter.item_action(
    request("/api/pages/page-1/duplicate", {
      method: "POST",
      headers: creator_headers('"page-page-1-r1"'),
      body: {
        endpoint_set: {
          canonical: {
            locator: { namespace: "Mine", page_name: "copy-primary" },
            delivery_profile: "inline",
          },
          alternates: [{
            locator: { namespace: "Mine", page_name: "copy-alias" },
            delivery_profile: "inline",
          }],
        },
      },
    }),
    context(owner_session),
  );
  assertEquals(duplicated.status, 201);
  const body = await duplicated.json();
  assertEquals(body.page.path, "/Mine/copy-primary");
  assertEquals(body.page.endpoints.alternates[0].path, "/Mine/copy-alias");
  assertEquals(body.page.content.input.md, "# Source");
});

Deno.test("page HTTP bulk access validates fully, then applies per page", async () => {
  const { adapter } = await make_fixture();
  await create_managed_page(adapter, "one", "private", ["kept"]);
  await create_managed_page(adapter, "two", "private");

  const guest = await adapter.bulk(
    request("/api/pages/bulk/access", {
      method: "POST",
      body: {
        access: "public",
        selection: [{ page_id: "page-1", expected_revision: 1 }],
      },
    }),
    context(guest_session),
  );
  assertEquals(guest.status, 401);

  const missing_csrf = await adapter.bulk(
    request("/api/pages/bulk/access", {
      method: "POST",
      body: {
        access: "public",
        selection: [{ page_id: "page-1", expected_revision: 1 }],
      },
    }),
    context(owner_session),
  );
  assertEquals(missing_csrf.status, 403);

  const malformed = await adapter.bulk(
    request("/api/pages/bulk/access", {
      method: "POST",
      headers: creator_headers(),
      body: {
        access: "public",
        selection: [{ page_id: "page-1", expected_revision: "1" }],
      },
    }),
    context(owner_session),
  );
  assertEquals(malformed.status, 400);
  assertEquals((await malformed.json()).error, "invalid_request");

  const duplicate_selection = await adapter.bulk(
    request("/api/pages/bulk/access", {
      method: "POST",
      headers: creator_headers(),
      body: {
        access: "public",
        selection: [
          { page_id: "page-1", expected_revision: 1 },
          { page_id: "page-1", expected_revision: 1 },
        ],
      },
    }),
    context(owner_session),
  );
  assertEquals(duplicate_selection.status, 422);
  assertEquals((await duplicate_selection.json()).error, "invalid_selection");

  const invalid_access = await adapter.bulk(
    request("/api/pages/bulk/access", {
      method: "POST",
      headers: creator_headers(),
      body: {
        access: "friends",
        selection: [{ page_id: "page-1", expected_revision: 1 }],
      },
    }),
    context(owner_session),
  );
  assertEquals(invalid_access.status, 422);
  assertEquals((await invalid_access.json()).error, "invalid_access");

  const applied = await adapter.bulk(
    request("/api/pages/bulk/access", {
      method: "POST",
      headers: creator_headers(),
      body: {
        access: "public",
        selection: [
          { page_id: "page-1", expected_revision: 1 },
          { page_id: "page-2", expected_revision: 9 },
          { page_id: "missing", expected_revision: 1 },
        ],
      },
    }),
    context(owner_session),
  );
  assertEquals(applied.status, 200);
  const applied_body = await applied.json();
  assertEquals(applied_body.ok, true);
  assertEquals(applied_body.results.length, 3);
  assertEquals(applied_body.results[0].ok, true);
  assertEquals(applied_body.results[0].page.access, "public");
  assertEquals(applied_body.results[0].page.tags, ["kept"]);
  assertEquals(applied_body.results[0].page.etag, '"page-page-1-r2"');
  assertEquals(applied_body.results[1], {
    page_id: "page-2",
    ok: false,
    error: "revision_conflict",
  });
  assertEquals(applied_body.results[2], {
    page_id: "missing",
    ok: false,
    error: "not_found",
  });

  const unknown = await adapter.bulk(
    request("/api/pages/bulk/publish", {
      method: "POST",
      headers: creator_headers(),
      body: { selection: [{ page_id: "page-1", expected_revision: 2 }] },
    }),
    context(owner_session),
  );
  assertEquals(unknown.status, 404);

  const wrong_method = await adapter.bulk(
    request("/api/pages/bulk/access", { method: "GET" }),
    context(owner_session),
  );
  assertEquals(wrong_method.status, 405);
  assertEquals(wrong_method.headers.get("allow"), "POST");
});

Deno.test("page HTTP bulk delete reports ordered, independent outcomes", async () => {
  const { adapter } = await make_fixture();
  await create_managed_page(adapter, "one", "public");
  await create_managed_page(adapter, "two", "public");

  const deleted = await adapter.bulk(
    request("/api/pages/bulk/delete", {
      method: "POST",
      headers: creator_headers(),
      body: {
        selection: [
          { page_id: "page-2", expected_revision: 1 },
          { page_id: "page-1", expected_revision: 9 },
        ],
      },
    }),
    context(owner_session),
  );
  assertEquals(deleted.status, 200);
  const deleted_body = await deleted.json();
  assertEquals(deleted_body.results, [
    { page_id: "page-2", ok: true },
    { page_id: "page-1", ok: false, error: "revision_conflict" },
  ]);

  const repeated = await adapter.bulk(
    request("/api/pages/bulk/delete", {
      method: "POST",
      headers: creator_headers(),
      body: { selection: [{ page_id: "page-2", expected_revision: 1 }] },
    }),
    context(owner_session),
  );
  assertEquals((await repeated.json()).results, [
    { page_id: "page-2", ok: false, error: "not_found" },
  ]);

  const survivor = await adapter.item(
    request("/api/pages/page-1"),
    context(owner_session),
  );
  assertEquals(survivor.status, 200);
});

Deno.test("page HTTP publishes and revision-replaces one PDF endpoint set", async () => {
  const { adapter, engine, pages } = await make_fixture();
  const original = pdf_bytes("original");
  const created = await adapter.collection(
    pdf_multipart_request("/api/pages", pdf_metadata(), original),
    context(owner_session),
  );

  assertEquals(created.status, 201);
  assertEquals(created.headers.get("etag"), '"page-page-1-r1"');
  const created_body = await created.json();
  assertEquals(created_body.page.content_type, "pdf");
  assertEquals(created_body.page.tags, ["reports"]);
  assertEquals(created_body.page.endpoints, {
    canonical: {
      locator: { namespace: "Mine", page_name: "report-preview" },
      path: "/Mine/report-preview",
      delivery_profile: "inline",
    },
    alternates: [{
      locator: { namespace: "Mine", page_name: "report-download" },
      path: "/Mine/report-download",
      delivery_profile: "attachment",
    }],
  });

  const inspected = await adapter.item(
    request("/api/pages/page-1"),
    context(owner_session),
  );
  assertEquals((await inspected.json()).page.content, {
    content_type: "pdf",
    input: {
      filename: "report.pdf",
      media_type: "application/pdf",
      size_bytes: original.byteLength,
      pdf_version: "1.7",
      replaceable: true,
    },
  });

  const preview = await deliver_page_locator_path(
    engine,
    pages,
    new Request("https://pager.test/Mine/report-preview", {
      headers: { range: "bytes=0-8" },
    }),
    { kind: "guest" },
  );
  assertEquals(preview.status, 206);
  assertEquals(preview.headers.get("content-disposition"), "inline");
  assertEquals(
    preview.headers.get("content-range"),
    `bytes 0-8/${original.byteLength}`,
  );
  assertEquals(
    new Uint8Array(await preview.arrayBuffer()),
    original.slice(0, 9),
  );

  const download = await deliver_page_locator_path(
    engine,
    pages,
    new Request("https://pager.test/Mine/report-download"),
    { kind: "guest" },
  );
  assertEquals(download.status, 200);
  assertStringIncludes(
    download.headers.get("content-disposition")!,
    'attachment; filename="report.pdf"',
  );
  assertEquals(new Uint8Array(await download.arrayBuffer()), original);

  const replacement = pdf_bytes("replacement");
  const replaced = await adapter.item(
    pdf_multipart_request(
      "/api/pages/page-1",
      {},
      replacement,
      {
        method: "PATCH",
        etag: '"page-page-1-r1"',
        filename: "revised.pdf",
      },
    ),
    context(owner_session),
  );
  assertEquals(replaced.status, 200);
  assertEquals(replaced.headers.get("etag"), '"page-page-1-r2"');
  const replaced_body = await replaced.json();
  assertEquals(replaced_body.page.revision, 2);
  assertEquals(replaced_body.page.content.input.filename, "revised.pdf");
  assertEquals(replaced_body.page.endpoints, created_body.page.endpoints);

  const stale = await adapter.item(
    pdf_multipart_request(
      "/api/pages/page-1",
      {},
      original,
      {
        method: "PATCH",
        etag: '"page-page-1-r1"',
      },
    ),
    context(owner_session),
  );
  assertEquals(stale.status, 412);

  const current = await deliver_page_locator_path(
    engine,
    pages,
    "/Mine/report-download",
    { kind: "guest" },
  );
  assertEquals(new Uint8Array(await current.arrayBuffer()), replacement);
});

Deno.test("page HTTP accepts a single PDF locator with either supported profile", async () => {
  const { adapter, engine, pages } = await make_fixture();
  const bytes = pdf_bytes("single-download");
  const created = await adapter.collection(
    pdf_multipart_request(
      "/api/pages",
      {
        endpoint_set: {
          canonical: {
            locator: { namespace: "Mine", page_name: "only-download" },
            delivery_profile: "attachment",
          },
        },
        access: "public",
      },
      bytes,
    ),
    context(owner_session),
  );
  assertEquals(created.status, 201);
  const body = await created.json();
  assertEquals(body.page.endpoints.alternates, []);
  assertEquals(body.page.endpoints.canonical.delivery_profile, "attachment");

  const delivered = await deliver_page_locator_path(
    engine,
    pages,
    "/Mine/only-download",
    { kind: "guest" },
  );
  assertEquals(delivered.status, 200);
  assertStringIncludes(
    delivered.headers.get("content-disposition")!,
    "attachment",
  );
  assertEquals(new Uint8Array(await delivered.arrayBuffer()), bytes);
});

Deno.test("page HTTP rejects malformed PDF multipart before mutation", async () => {
  const { adapter, repository } = await make_fixture();
  const cases = [
    {
      input: pdf_multipart_request(
        "/api/pages",
        pdf_metadata(),
        pdf_bytes(),
        { extra_part: true },
      ),
      status: 400,
      error: "invalid_request",
    },
    {
      input: pdf_multipart_request(
        "/api/pages",
        {
          ...pdf_metadata(),
          endpoint_set: {
            ...pdf_metadata().endpoint_set,
            canonical: { delivery_profile: "attachment" },
          },
        },
        pdf_bytes(),
      ),
      status: 400,
      error: "invalid_request",
    },
    {
      input: pdf_multipart_request(
        "/api/pages",
        pdf_metadata(),
        pdf_bytes(),
        { file_media_type: "application/octet-stream" },
      ),
      status: 415,
      error: "unsupported_media_type",
    },
    {
      input: pdf_multipart_request(
        "/api/pages",
        pdf_metadata(),
        text_encoder.encode("not pdf"),
      ),
      status: 422,
      error: "invalid_input",
    },
  ];

  for (const test_case of cases) {
    const response = await adapter.collection(
      test_case.input,
      context(owner_session),
    );
    assertEquals(response.status, test_case.status);
    assertEquals((await response.json()).error, test_case.error);
  }
  assertEquals(
    await repository.resolve_page_endpoint({
      namespace: "Mine",
      page_name: "report-preview",
    }),
    null,
  );

  const malformed = await adapter.collection(
    new Request("https://pager.test/api/pages", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=missing",
        "x-csrf-token": csrf_token,
      },
      body: "--missing\r\nbroken",
    }),
    context(owner_session),
  );
  assertEquals(malformed.status, 400);
  assertEquals((await malformed.json()).error, "invalid_request");
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

Deno.test("bearer keys drive the full page lifecycle by permission", async () => {
  const { adapter } = await make_fixture();

  // A key-authenticated create is always managed: tags are accepted, the
  // response carries owner surfaces, and no CSRF token is involved.
  const created = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      headers: bearer_headers("owner-all"),
      body: { ...create_body("Mine", "automation"), tags: ["Ci"] },
    }),
    context(guest_session),
  );
  assertEquals(created.status, 201);
  const created_body = await created.json();
  assertEquals(created_body.page.tags, ["ci"]);
  assert(typeof created_body.management_url === "string");
  const page_id = created_body.page.page_id;
  const etag = created.headers.get("etag");
  assert(etag !== null);

  // read permission lists and inspects the owner's pages.
  const listed = await adapter.collection(
    request("/api/pages", { headers: { authorization: "Bearer owner-read" } }),
    context(guest_session),
  );
  assertEquals(listed.status, 200);
  assertEquals(
    (await listed.json()).pages.map((page: { page_id: string }) =>
      page.page_id
    ),
    [page_id],
  );
  const inspected = await adapter.item(
    request(`/api/pages/${page_id}`, {
      headers: { authorization: "Bearer owner-read" },
    }),
    context(guest_session),
  );
  assertEquals(inspected.status, 200);

  // write permission updates and renames without any CSRF header.
  const updated = await adapter.item(
    request(`/api/pages/${page_id}`, {
      method: "PATCH",
      headers: bearer_headers("owner-write", etag),
      body: { access: "public" },
    }),
    context(guest_session),
  );
  assertEquals(updated.status, 200);
  const updated_etag = updated.headers.get("etag");
  assert(updated_etag !== null);

  // delete permission removes the page.
  const deleted = await adapter.item(
    request(`/api/pages/${page_id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer owner-all", "if-match": updated_etag },
    }),
    context(guest_session),
  );
  assertEquals(deleted.status, 204);
});

Deno.test("bearer keys without the mapped permission are denied", async () => {
  const { adapter } = await make_fixture();
  const created = await create_managed_page(adapter);
  const etag = created.headers.get("etag")!;
  const page_id = (await created.json()).page.page_id;

  const denied: [Promise<Response>, string][] = [
    [
      adapter.collection(
        request("/api/pages", {
          headers: { authorization: "Bearer owner-write" },
        }),
        context(guest_session),
      ),
      "list without read",
    ],
    [
      adapter.collection(
        request("/api/pages", {
          method: "POST",
          headers: bearer_headers("owner-read"),
          body: create_body("Mine", "denied"),
        }),
        context(guest_session),
      ),
      "create without write",
    ],
    [
      adapter.item(
        request(`/api/pages/${page_id}`, {
          method: "PATCH",
          headers: bearer_headers("owner-read", etag),
          body: { access: "public" },
        }),
        context(guest_session),
      ),
      "update without write",
    ],
    [
      adapter.item(
        request(`/api/pages/${page_id}`, {
          method: "DELETE",
          headers: { authorization: "Bearer owner-write", "if-match": etag },
        }),
        context(guest_session),
      ),
      "delete without delete",
    ],
    [
      adapter.item_action(
        request(`/api/pages/${page_id}/rename`, {
          method: "POST",
          headers: bearer_headers("owner-read", etag),
          body: { page_name: "renamed" },
        }),
        context(guest_session),
      ),
      "rename without write",
    ],
    [
      adapter.bulk(
        request("/api/pages/bulk/delete", {
          method: "POST",
          headers: bearer_headers("owner-write"),
          body: { selection: [{ page_id, expected_revision: 1 }] },
        }),
        context(guest_session),
      ),
      "bulk delete without delete",
    ],
  ];
  for (const [pending, label] of denied) {
    const response = await pending;
    assertEquals(response.status, 403, label);
    assertEquals((await response.json()).error, "insufficient_permission");
  }
});

Deno.test("domain ownership still applies to fully permitted foreign keys", async () => {
  const { adapter } = await make_fixture();
  const created = await create_managed_page(adapter);
  const page_id = (await created.json()).page.page_id;

  const foreign = await adapter.item(
    request(`/api/pages/${page_id}`, {
      headers: { authorization: "Bearer other-all" },
    }),
    context(guest_session),
  );
  assertEquals(foreign.status, 404);

  const foreign_create = await adapter.collection(
    request("/api/pages", {
      method: "POST",
      headers: bearer_headers("other-all"),
      body: create_body("Mine", "intruder"),
    }),
    context(guest_session),
  );
  assertEquals(foreign_create.status, 403);
});

Deno.test("an unusable explicit bearer never falls back to the session", async () => {
  const { adapter } = await make_fixture();
  for (
    const authorization of [
      "Bearer unknown-token",
      "Basic Zm9vOmJhcg==",
      "bearer owner-all",
      "Bearer owner-all extra",
    ]
  ) {
    const response = await adapter.collection(
      request("/api/pages", { headers: { authorization } }),
      context(owner_session),
    );
    assertEquals(response.status, 401);
    assertEquals(
      response.headers.get("www-authenticate"),
      'Bearer realm="api"',
    );
    assertEquals((await response.json()).error, "invalid_bearer");
  }
});
