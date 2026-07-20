import { assertEquals, assertThrows } from "@std/assert";
import type {
  ExplorePublicPagesRequest,
  ExplorePublicPagesResult,
  PublicPageExplorer,
  PublicPageSummary,
} from "../page/interfaces.ts";
import { SitePublicExplorationPresenter } from "./public-exploration.ts";

function summary(
  namespace: string,
  page_name?: string,
  tags: string[] = [],
): PublicPageSummary {
  const locator = page_name === undefined
    ? { namespace }
    : { namespace, page_name };
  const path = page_name === undefined
    ? `/${namespace}`
    : `/${namespace}/${page_name}`;
  return {
    locator,
    path,
    endpoints: {
      canonical: { locator, path, delivery_profile: "inline" },
      alternates: [],
    },
    stewardship: "managed",
    content_type: "md-page",
    media_type: "text/html; charset=utf-8",
    size_bytes: 42,
    tags,
    created_at: new Date("2026-07-19T01:00:00.000Z"),
    updated_at: new Date("2026-07-19T02:00:00.000Z"),
  };
}

class FakePublicExplorer implements PublicPageExplorer {
  result: ExplorePublicPagesResult = {
    ok: true,
    pages: [],
    next_cursor: null,
  };
  requests: ExplorePublicPagesRequest[] = [];

  explore_public(
    request: ExplorePublicPagesRequest,
  ): Promise<ExplorePublicPagesResult> {
    this.requests.push(structuredClone(request));
    return Promise.resolve(structuredClone(this.result));
  }
}

Deno.test("public exploration presenter maps safe links and bound continuation", async () => {
  const pages = new FakePublicExplorer();
  pages.result = {
    ok: true,
    pages: [summary("Alice"), summary("Alice", "Notes", ["news"])],
    next_cursor: "opaque-next",
  };
  const presenter = new SitePublicExplorationPresenter({
    pages,
    max_results: 2,
  });

  const view = await presenter.present({
    namespace_query: " Alice ",
    page_name_query: " Notes ",
    tag: " News ",
  });

  assertEquals(pages.requests, [{
    namespace_query: "Alice",
    page_name_query: "Notes",
    tag: "News",
    limit: 2,
  }]);
  assertEquals(view, {
    namespace_query: "Alice",
    page_name_query: "Notes",
    tag: "News",
    is_search: true,
    pages: [{
      namespace: "Alice",
      page_name: null,
      label: "Default page",
      direct_path: "/Alice",
      site_path: "/site/Alice",
      endpoints: {
        canonical: {
          locator: { namespace: "Alice" },
          path: "/Alice",
          delivery_profile: "inline",
        },
        alternates: [],
      },
      content_type: "md-page",
      size_bytes: 42,
      tags: [],
      updated_at: new Date("2026-07-19T02:00:00.000Z"),
    }, {
      namespace: "Alice",
      page_name: "Notes",
      label: "Notes",
      direct_path: "/Alice/Notes",
      site_path: "/site/Alice/Notes",
      endpoints: {
        canonical: {
          locator: { namespace: "Alice", page_name: "Notes" },
          path: "/Alice/Notes",
          delivery_profile: "inline",
        },
        alternates: [],
      },
      content_type: "md-page",
      size_bytes: 42,
      tags: ["news"],
      updated_at: new Date("2026-07-19T02:00:00.000Z"),
    }],
    next_path: "/site?namespace=Alice&page=Notes&tag=News&cursor=opaque-next",
    error: null,
  });
});

Deno.test("public exploration presenter browses on blank fields and reports invalid cursors", async () => {
  const pages = new FakePublicExplorer();
  pages.result = { ok: false, reason: "invalid_cursor" };
  const presenter = new SitePublicExplorationPresenter({ pages });

  const view = await presenter.present({
    namespace_query: "  ",
    page_name_query: "",
    cursor: "tampered",
  });

  assertEquals(pages.requests, [{ limit: 20, cursor: "tampered" }]);
  assertEquals(view, {
    namespace_query: "",
    page_name_query: "",
    tag: "",
    is_search: false,
    pages: [],
    next_path: null,
    error: "invalid_cursor",
  });
});

Deno.test("public exploration presenter validates its result bound", () => {
  const pages = new FakePublicExplorer();
  assertThrows(
    () => new SitePublicExplorationPresenter({ pages, max_results: 0 }),
    Error,
    "positive safe integer",
  );
});
