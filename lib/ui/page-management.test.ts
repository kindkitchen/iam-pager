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
  managed_md_page_draft,
  management_summary_from_api,
  prepare_managed_delete_request,
  prepare_managed_inspect_request,
  prepare_managed_list_request,
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
    path: "/Mine/notes/today",
    access: "private",
    content_type: "md-page",
    size_bytes: panel.pages[0]!.size_bytes,
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
  const valid = {
    page_id: "p1",
    path: "/Mine",
    access: "public",
    content_type: "md-page",
    size_bytes: 10,
    updated_at: now.toISOString(),
    revision: 2,
    etag: '"page-p1-r2"',
    management_url: "/api/pages/p1",
  };
  assert(management_summary_from_api(valid) !== null);
  assertEquals(management_summary_from_api(null), null);
  assertEquals(management_summary_from_api("row"), null);
  assertEquals(
    management_summary_from_api({ ...valid, access: "internal" }),
    null,
  );
  assertEquals(management_summary_from_api({ ...valid, etag: "" }), null);
  assertEquals(
    management_summary_from_api({ ...valid, size_bytes: "10" }),
    null,
  );
});

Deno.test("list request carries limit and URL-safe cursor", () => {
  assertEquals(prepare_managed_list_request().url, "/api/pages?limit=20");
  const request = prepare_managed_list_request({
    cursor: "abc+/=",
    limit: 5,
  });
  assertEquals(request.method, "GET");
  assertEquals(request.url, "/api/pages?limit=5&cursor=abc%2B%2F%3D");
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

  const both = prepare_managed_update_request(
    target,
    { access: "private", content: { markdown: "# New", css: "b { }" } },
    "token-1",
  );
  assertEquals(both.body, {
    access: "private",
    content: {
      content_type: "md-page",
      input: { md: "# New", css: "b { }" },
    },
  });

  assertThrows(
    () => prepare_managed_update_request(target, {}, "token-1"),
    Error,
    "access, content, or both",
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
