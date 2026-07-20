import { assertEquals, assertThrows } from "@std/assert";
import { type Locator, locator_key } from "../locator/model.ts";
import type {
  ListPublicPagesRequest,
  ListPublicPagesResult,
  PublicPageLister,
  PublicPageSummary,
  PublicPageViewer,
  ViewPublicPageResult,
} from "../page/interfaces.ts";
import { CreatorPublicPageViewPresenter } from "./public-page-view.ts";

function summary(
  namespace: string,
  page_name?: string,
  stewardship: "trial" | "managed" = "managed",
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
    stewardship,
    content_type: "md-page",
    media_type: "text/html; charset=utf-8",
    size_bytes: 42,
    tags: [],
    created_at: new Date("2026-07-19T01:00:00.000Z"),
    updated_at: new Date("2026-07-19T02:00:00.000Z"),
  };
}

class FakePublicPages implements PublicPageViewer, PublicPageLister {
  readonly views = new Map<string, ViewPublicPageResult>();
  listed: ListPublicPagesResult = {
    ok: true,
    pages: [],
    next_cursor: null,
  };
  view_calls: Locator[] = [];
  list_calls: ListPublicPagesRequest[] = [];

  view_public(locator: Locator): Promise<ViewPublicPageResult> {
    this.view_calls.push(structuredClone(locator));
    return Promise.resolve(
      this.views.get(locator_key(locator)) ?? {
        ok: false,
        reason: "not_found",
      },
    );
  }

  list_public(
    request: ListPublicPagesRequest,
  ): Promise<ListPublicPagesResult> {
    this.list_calls.push(structuredClone(request));
    return Promise.resolve(structuredClone(this.listed));
  }
}

function html_view(page: PublicPageSummary): ViewPublicPageResult {
  return {
    ok: true,
    page,
    payload: {
      media_type: "text/html; charset=utf-8",
      body: `<!doctype html><p>${page.path}</p>`,
    },
  };
}

Deno.test("public page presenter keeps missing views non-disclosing", async () => {
  const pages = new FakePublicPages();
  const presenter = new CreatorPublicPageViewPresenter({ pages });
  assertEquals(
    await presenter.present({ namespace: "Alice", page_name: "missing" }),
    { kind: "missing" },
  );
  assertEquals(pages.list_calls, []);
});

Deno.test("public page presenter builds isolated preview and creator links", async () => {
  const pages = new FakePublicPages();
  const current = summary("Alice", "notes");
  const default_page = summary("Alice");
  const other_one = summary("Alice", "a");
  const other_two = summary("Alice", "z");
  pages.views.set(locator_key(current.locator), html_view(current));
  pages.views.set(locator_key(default_page.locator), html_view(default_page));
  pages.listed = {
    ok: true,
    pages: [default_page, other_one, current, other_two],
    next_cursor: "more",
  };
  const presenter = new CreatorPublicPageViewPresenter({
    pages,
    max_other_pages: 1,
  });

  const view = await presenter.present(current.locator);
  assertEquals(view, {
    kind: "page",
    page: current,
    direct_path: "/Alice/notes",
    preview: {
      kind: "html",
      document: "<!doctype html><p>/Alice/notes</p>",
    },
    default_page: {
      label: "Default page",
      direct_path: "/Alice",
      site_path: "/site/Alice",
    },
    other_pages: [{
      label: "a",
      direct_path: "/Alice/a",
      site_path: "/site/Alice/a",
    }],
    has_more_public_pages: true,
  });
  assertEquals(pages.list_calls, [{ namespace: "Alice", limit: 3 }]);
});

Deno.test("public default page does not link to itself", async () => {
  const pages = new FakePublicPages();
  const current = summary("Alice");
  const other = summary("Alice", "notes");
  pages.views.set(locator_key(current.locator), html_view(current));
  pages.listed = { ok: true, pages: [current, other], next_cursor: null };
  const presenter = new CreatorPublicPageViewPresenter({ pages });

  const view = await presenter.present(current.locator);
  assertEquals(view.kind, "page");
  if (view.kind !== "page") return;
  assertEquals(view.default_page, null);
  assertEquals(view.other_pages.map((page) => page.label), ["notes"]);
  assertEquals(pages.view_calls, [{ namespace: "Alice" }]);
});

Deno.test("trial views stay out of creator listings", async () => {
  const pages = new FakePublicPages();
  const trial = summary("Free", undefined, "trial");
  pages.views.set(locator_key(trial.locator), {
    ok: true,
    page: trial,
    payload: null,
  });
  const presenter = new CreatorPublicPageViewPresenter({ pages });

  const view = await presenter.present(trial.locator);
  assertEquals(view, {
    kind: "page",
    page: trial,
    direct_path: "/Free",
    preview: {
      kind: "fallback",
      media_type: "text/html; charset=utf-8",
      size_bytes: 42,
    },
    default_page: null,
    other_pages: [],
    has_more_public_pages: false,
  });
  assertEquals(pages.list_calls, []);
});

Deno.test("public page presenter validates its bounded link limit", () => {
  const pages = new FakePublicPages();
  assertThrows(
    () => new CreatorPublicPageViewPresenter({ pages, max_other_pages: 0 }),
    Error,
    "positive safe integer",
  );
});
