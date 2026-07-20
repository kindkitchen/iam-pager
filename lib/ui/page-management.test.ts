import { assert, assertEquals, assertThrows } from "@std/assert";
import { MdPageHandler } from "../content/md-page.ts";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import { MemoryNamespaceRepository } from "../namespace/memory-repository.ts";
import type { PageClock, PageIdGenerator } from "../page/interfaces.ts";
import { MemoryPageRepository } from "../page/memory-repository.ts";
import { RepositoryNamespaceAuthorityResolver } from "../page/namespace-authority.ts";
import { PageService } from "../page/service.ts";
import type { AuthenticatedSession, Session } from "../session/model.ts";
import {
  CreatorPageManagementPresenter,
  format_size_bytes,
  managed_bulk_access_from_api,
  managed_bulk_delete_from_api,
  managed_list_from_api,
  managed_md_page_draft,
  managed_revision_selection,
  managed_tags_from_input,
  management_summary_from_api,
  management_summary_matches_filters,
  prepare_managed_bulk_access_request,
  prepare_managed_bulk_delete_request,
  prepare_managed_delete_request,
  prepare_managed_duplicate_request,
  prepare_managed_inspect_request,
  prepare_managed_list_request,
  prepare_managed_rename_request,
  prepare_managed_update_request,
  present_management_summary,
} from "./page-management.ts";

const now = new Date("2026-07-19T12:00:00.000Z");

const guest_session: Session = {
  kind: "guest",
  session_id: "session-1",
  session_version: 1,
  created_at: now,
  last_seen_at: now,
  absolute_expires_at: new Date("2026-07-26T12:00:00.000Z"),
};

const creator_session: AuthenticatedSession = {
  ...guest_session,
  kind: "authenticated",
  user_id: "creator-1",
  authenticated_at: now,
  idle_expires_at: new Date("2026-08-18T12:00:00.000Z"),
  csrf_token: "c".repeat(43),
};

class SequenceIds implements PageIdGenerator {
  #next = 0;
  generate(): string {
    return `page-${++this.#next}`;
  }
}

class FixedClock implements PageClock {
  now(): Date {
    return new Date(now);
  }
}

async function make_fixture(options: { page_size?: number } = {}) {
  const namespaces = new MemoryNamespaceRepository();
  await namespaces.reserve({
    namespace: "Mine",
    owner_user_id: creator_session.user_id,
  });
  const pages = new PageService({
    engine: new LocatorEngine({ strategies: [new PathSlugStrategy()] }),
    repository: new MemoryPageRepository(),
    namespace_authority: new RepositoryNamespaceAuthorityResolver(namespaces),
    handlers: [new MdPageHandler()],
    page_id_generator: new SequenceIds(),
    clock: new FixedClock(),
  });
  const presenter = new CreatorPageManagementPresenter({
    pages,
    ...(options.page_size === undefined
      ? {}
      : { page_size: options.page_size }),
  });
  return { pages, presenter };
}

async function create_page(pages: PageService, page_name: string) {
  const result = await pages.create_managed({
    actor: { kind: "user", user_id: creator_session.user_id },
    locator: { namespace: "Mine", page_name },
    access: "private",
    content: { content_type: "md-page", input: { md: "# Hi" } },
  });
  assert(result.ok);
  return result.page;
}

function api_summary(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    page_id: "p1",
    locator: { namespace: "Mine", page_name: "notes" },
    path: "/Mine/notes",
    endpoints: {
      canonical: {
        locator: { namespace: "Mine", page_name: "notes" },
        path: "/Mine/notes",
        delivery_profile: "inline",
      },
      alternates: [],
    },
    access: "private",
    content_type: "md-page",
    size_bytes: 10,
    tags: ["notes"],
    updated_at: now.toISOString(),
    revision: 2,
    etag: '"page-p1-r2"',
    management_url: "/api/pages/p1",
    ...overrides,
  };
}

Deno.test("panel stays hidden for guest sessions", async () => {
  const { presenter } = await make_fixture();
  assertEquals(await presenter.present(guest_session), { kind: "hidden" });
});

Deno.test("panel lists creator pages as API-shaped rows", async () => {
  const { pages, presenter } = await make_fixture();
  await create_page(pages, "notes/today");
  const panel = await presenter.present(creator_session);
  assert(panel.kind === "creator");
  assertEquals(panel.csrf_token, creator_session.csrf_token);
  assertEquals(panel.next_cursor, null);
  assertEquals(panel.pages, [{
    page_id: "page-1",
    locator: { namespace: "Mine", page_name: "notes/today" },
    path: "/Mine/notes/today",
    endpoints: {
      canonical: {
        locator: { namespace: "Mine", page_name: "notes/today" },
        path: "/Mine/notes/today",
        delivery_profile: "inline",
      },
      alternates: [],
    },
    access: "private",
    content_type: "md-page",
    size_bytes: panel.pages[0]!.size_bytes,
    tags: [],
    updated_at: now.toISOString(),
    revision: 1,
    etag: '"page-page-1-r1"',
    management_url: "/api/pages/page-1",
  }]);
  assert(panel.pages[0]!.size_bytes > 0);
});

Deno.test("panel returns a continuation cursor beyond the page size", async () => {
  const { pages, presenter } = await make_fixture({ page_size: 1 });
  await create_page(pages, "one");
  await create_page(pages, "two");
  const panel = await presenter.present(creator_session);
  assert(panel.kind === "creator");
  assertEquals(panel.pages.length, 1);
  assert(panel.next_cursor !== null);
});

Deno.test("present_management_summary round-trips through the API validator", async () => {
  const { pages } = await make_fixture();
  const page = await create_page(pages, "round-trip");
  const summary = present_management_summary(page);
  assertEquals(management_summary_from_api({ ...summary }), summary);
});

Deno.test("management_summary_from_api rejects malformed rows", () => {
  const valid = api_summary();
  assert(management_summary_from_api(valid) !== null);
  assertEquals(management_summary_from_api(null), null);
  assertEquals(management_summary_from_api("row"), null);
  assertEquals(
    management_summary_from_api({ ...valid, access: "internal" }),
    null,
  );
  assertEquals(
    management_summary_from_api({ ...valid, tags: ["Notes"] }),
    null,
  );
  assertEquals(management_summary_from_api({ ...valid, locator: null }), null);
  assertEquals(
    management_summary_from_api({ ...valid, path: "javascript:alert(1)" }),
    null,
  );
  assertEquals(
    management_summary_from_api({
      ...valid,
      endpoints: {
        canonical: {
          locator: { namespace: "Mine", page_name: "notes" },
          path: "//outside.test/notes",
          delivery_profile: "inline",
        },
        alternates: [],
      },
    }),
    null,
  );
  assertEquals(
    management_summary_from_api({
      ...valid,
      endpoints: {
        canonical: valid.endpoints,
        alternates: [],
      },
    }),
    null,
  );
  assertEquals(
    management_summary_from_api({ ...valid, updated_at: "July 20, 2026" }),
    null,
  );
  assertEquals(management_summary_from_api({ ...valid, etag: "" }), null);
  assertEquals(
    management_summary_from_api({ ...valid, size_bytes: "10" }),
    null,
  );
});

Deno.test("list request carries filters, limit, and URL-safe cursor", () => {
  assertEquals(prepare_managed_list_request().url, "/api/pages?limit=20");
  const request = prepare_managed_list_request({
    cursor: "abc+/=",
    limit: 5,
    filters: { name: " Notes ", access: "private", tag: " Work " },
  });
  assertEquals(request.method, "GET");
  assertEquals(
    request.url,
    "/api/pages?limit=5&name=Notes&access=private&tag=Work&cursor=abc%2B%2F%3D",
  );
  assertEquals(
    prepare_managed_list_request({ filters: { name: " ", tag: "" } }).url,
    "/api/pages?limit=20",
  );
});

Deno.test("managed_list_from_api validates complete list responses", () => {
  const expected = management_summary_from_api(api_summary());
  assert(expected !== null);
  assertEquals(
    managed_list_from_api({
      ok: true,
      pages: [api_summary()],
      next_cursor: "next",
    }),
    { pages: [expected], next_cursor: "next" },
  );
  assertEquals(
    managed_list_from_api({ ok: false, pages: [], next_cursor: null }),
    null,
  );
  assertEquals(
    managed_list_from_api({ ok: true, pages: [null], next_cursor: null }),
    null,
  );
  assertEquals(
    managed_list_from_api({ ok: true, pages: [], next_cursor: 1 }),
    null,
  );
});

Deno.test("inspect request targets the management URL without credentials", () => {
  const request = prepare_managed_inspect_request("/api/pages/p1");
  assertEquals(request.url, "/api/pages/p1");
  assertEquals(request.method, "GET");
  assertEquals([...request.headers.keys()], []);
});

Deno.test("update request binds CSRF, If-Match, and only supplied fields", () => {
  const target = { management_url: "/api/pages/p1", etag: '"page-p1-r3"' };
  const access_only = prepare_managed_update_request(
    target,
    { access: "public" },
    "token-1",
  );
  assertEquals(access_only.method, "PATCH");
  assertEquals(access_only.url, "/api/pages/p1");
  assertEquals(access_only.headers.get("x-csrf-token"), "token-1");
  assertEquals(access_only.headers.get("if-match"), '"page-p1-r3"');
  assertEquals(access_only.headers.get("content-type"), "application/json");
  assertEquals(access_only.body, { access: "public" });

  const content_only = prepare_managed_update_request(
    target,
    { content: { markdown: "# New", css: "" } },
    "token-1",
  );
  assertEquals(content_only.body, {
    content: { content_type: "md-page", input: { md: "# New" } },
  });

  const combined = prepare_managed_update_request(
    target,
    {
      access: "private",
      tags: ["notes", "work"],
      content: { markdown: "# New", css: "b { }" },
    },
    "token-1",
  );
  assertEquals(combined.body, {
    access: "private",
    tags: ["notes", "work"],
    content: {
      content_type: "md-page",
      input: { md: "# New", css: "b { }" },
    },
  });

  assertThrows(
    () => prepare_managed_update_request(target, {}, "token-1"),
    Error,
    "access, tags, or content",
  );
});

Deno.test("delete request is bodyless with CSRF and If-Match", () => {
  const request = prepare_managed_delete_request(
    { management_url: "/api/pages/p1", etag: '"page-p1-r3"' },
    "token-1",
  );
  assertEquals(request.method, "DELETE");
  assertEquals(request.body, undefined);
  assertEquals(request.headers.get("x-csrf-token"), "token-1");
  assertEquals(request.headers.get("if-match"), '"page-p1-r3"');
  assertEquals(request.headers.get("content-type"), null);
});

Deno.test("rename and duplicate requests bind the source revision", () => {
  const target = { management_url: "/api/pages/p1", etag: '"page-p1-r2"' };
  const rename = prepare_managed_rename_request(
    target,
    "archive/notes",
    "csrf",
  );
  assertEquals(rename.url, "/api/pages/p1/rename");
  assertEquals(rename.method, "POST");
  assertEquals(rename.headers.get("content-type"), "application/json");
  assertEquals(rename.headers.get("x-csrf-token"), "csrf");
  assertEquals(rename.headers.get("if-match"), '"page-p1-r2"');
  assertEquals(rename.body, { page_name: "archive/notes" });
  assertEquals(
    prepare_managed_rename_request(target, undefined, "csrf").body,
    {},
  );

  const duplicate = prepare_managed_duplicate_request(target, "csrf");
  assertEquals(duplicate.url, "/api/pages/p1/duplicate");
  assertEquals(duplicate.method, "POST");
  assertEquals(duplicate.headers.get("if-match"), '"page-p1-r2"');
  assertEquals(duplicate.headers.get("content-type"), null);
  assertEquals(duplicate.body, undefined);
});

Deno.test("bulk requests use current explicit revisions and strict JSON shapes", () => {
  const first = management_summary_from_api(api_summary());
  const second = management_summary_from_api(api_summary({
    page_id: "p2",
    locator: { namespace: "Mine", page_name: "other" },
    path: "/Mine/other",
    endpoints: {
      canonical: {
        locator: { namespace: "Mine", page_name: "other" },
        path: "/Mine/other",
        delivery_profile: "inline",
      },
      alternates: [],
    },
    revision: 3,
    etag: '"page-p2-r3"',
    management_url: "/api/pages/p2",
  }));
  assert(first !== null && second !== null);
  const selection = managed_revision_selection(
    [first, second],
    new Set(["p2", "p1"]),
  );
  assertEquals(selection, [
    { page_id: "p1", expected_revision: 2 },
    { page_id: "p2", expected_revision: 3 },
  ]);

  const access = prepare_managed_bulk_access_request(
    selection,
    "public",
    "csrf",
  );
  assertEquals(access.url, "/api/pages/bulk/access");
  assertEquals(access.method, "POST");
  assertEquals(access.headers.get("content-type"), "application/json");
  assertEquals(access.headers.get("x-csrf-token"), "csrf");
  assertEquals(access.headers.get("if-match"), null);
  assertEquals(access.body, { access: "public", selection });

  const deletion = prepare_managed_bulk_delete_request(selection, "csrf");
  assertEquals(deletion.url, "/api/pages/bulk/delete");
  assertEquals(deletion.body, { selection });
  assertThrows(
    () => managed_revision_selection([first], new Set()),
    Error,
    "requires 1-100 pages",
  );
});

Deno.test("bulk response validators preserve ordered independent outcomes", () => {
  const page = management_summary_from_api(api_summary());
  assert(page !== null);
  assertEquals(
    managed_bulk_access_from_api({
      ok: true,
      results: [
        { page_id: "p1", ok: true, page: api_summary() },
        { page_id: "p2", ok: false, error: "revision_conflict" },
      ],
    }),
    [
      { page_id: "p1", ok: true, page },
      { page_id: "p2", ok: false, error: "revision_conflict" },
    ],
  );
  assertEquals(
    managed_bulk_delete_from_api({
      ok: true,
      results: [
        { page_id: "p1", ok: true },
        { page_id: "p2", ok: false, error: "not_found" },
      ],
    }),
    [
      { page_id: "p1", ok: true },
      { page_id: "p2", ok: false, error: "not_found" },
    ],
  );
  assertEquals(
    managed_bulk_access_from_api({
      ok: true,
      results: [{ page_id: "p1", ok: true, page: null }],
    }),
    null,
  );
  assertEquals(
    managed_bulk_delete_from_api({
      ok: true,
      results: [{ page_id: "p1", ok: false, error: "revision_exhausted" }],
    }),
    null,
  );
});

Deno.test("tag input and local filter matching mirror management semantics", () => {
  const page = management_summary_from_api(api_summary());
  assert(page !== null);
  assertEquals(managed_tags_from_input(" Notes, work, ,Deno "), [
    "Notes",
    "work",
    "Deno",
  ]);
  assertEquals(
    management_summary_matches_filters(page, {
      name: " NOTE ",
      access: "private",
      tag: " Notes ",
    }),
    true,
  );
  assertEquals(
    management_summary_matches_filters(page, { name: "missing" }),
    false,
  );
  assertEquals(
    management_summary_matches_filters(page, { access: "public" }),
    false,
  );
});

Deno.test("managed_md_page_draft accepts only editable md-page content", () => {
  assertEquals(
    managed_md_page_draft({
      content_type: "md-page",
      input: { md: "# Hi", css: "b { }" },
    }),
    { markdown: "# Hi", css: "b { }" },
  );
  assertEquals(
    managed_md_page_draft({ content_type: "md-page", input: { md: "# Hi" } }),
    { markdown: "# Hi", css: "" },
  );
  assertEquals(managed_md_page_draft(null), null);
  assertEquals(
    managed_md_page_draft({ content_type: "html", input: { md: "# Hi" } }),
    null,
  );
  assertEquals(
    managed_md_page_draft({ content_type: "md-page", input: { md: 1 } }),
    null,
  );
  assertEquals(
    managed_md_page_draft({
      content_type: "md-page",
      input: { md: "# Hi", css: 2 },
    }),
    null,
  );
});

Deno.test("format_size_bytes scales to KiB and MiB", () => {
  assertEquals(format_size_bytes(0), "0 B");
  assertEquals(format_size_bytes(1023), "1023 B");
  assertEquals(format_size_bytes(1024), "1 KiB");
  assertEquals(format_size_bytes(1536), "1.5 KiB");
  assertEquals(format_size_bytes(5 * 1024 * 1024), "5 MiB");
  assertThrows(() => format_size_bytes(-1));
});
