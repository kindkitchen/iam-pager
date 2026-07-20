import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { PublicExplorationPanel } from "../../components/PublicExploration.tsx";
import type { PublicExploration } from "./public-exploration.ts";

Deno.test("public exploration component renders GET search and safe result links", () => {
  const exploration: PublicExploration = {
    namespace_query: "Alice",
    page_name_query: "notes",
    tag: "news",
    is_search: true,
    pages: [{
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
        alternates: [{
          locator: { namespace: "Alice", page_name: "Notes-download" },
          path: "/Alice/Notes-download",
          delivery_profile: "attachment",
        }],
      },
      content_type: "md-page",
      size_bytes: 42,
      tags: ["news", "release"],
      updated_at: new Date("2026-07-19T02:00:00.000Z"),
    }],
    next_path: "/site?namespace=Alice&page=notes&tag=news&cursor=next",
    error: null,
  };

  const html = render_to_string(
    <PublicExplorationPanel exploration={exploration} />,
  );

  assertStringIncludes(html, 'action="/site"');
  assertStringIncludes(html, 'method="GET"');
  assertStringIncludes(html, 'name="namespace" value="Alice"');
  assertStringIncludes(html, 'name="page" value="notes"');
  assertStringIncludes(html, 'name="tag" value="news"');
  assertStringIncludes(html, "tags: news, release");
  assertStringIncludes(html, 'href="/site/Alice/Notes"');
  assertStringIncludes(html, 'href="/Alice/Notes"');
  assertStringIncludes(html, 'href="/Alice/Notes-download"');
  assertStringIncludes(html, "Open alternate attachment");
  assertStringIncludes(html, "Private and guest pages never appear here");
  assertStringIncludes(html, "More public pages");
  assertEquals(html.includes("page_id"), false);
});

Deno.test("public exploration component renders a continuation error without rows", () => {
  const html = render_to_string(
    <PublicExplorationPanel
      exploration={{
        namespace_query: "",
        page_name_query: "",
        tag: "",
        is_search: false,
        pages: [],
        next_path: null,
        error: "invalid_cursor",
      }}
    />,
  );
  assertStringIncludes(html, "result continuation is invalid");
  assertEquals(html.includes("No public creator pages are available"), false);
});
