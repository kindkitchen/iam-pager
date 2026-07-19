import { assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { PublicPageViewPage } from "../../components/PublicPageView.tsx";
import type { PublicPageView } from "./public-page-view.ts";
import type { SiteNavigation } from "./site-navigation.ts";

const navigation: SiteNavigation = {
  session_label: "Guest session",
  action: {
    kind: "link",
    href: "/auth/google/start?return_to=%2Fsite%2FAlice%2Fnotes",
    label: "Sign in with Google",
  },
};

Deno.test("public page wrapper isolates creator HTML and renders platform links", () => {
  const view: PublicPageView = {
    kind: "page",
    page: {
      locator: { namespace: "Alice", page_name: "notes" },
      path: "/Alice/notes",
      stewardship: "managed",
      content_type: "md-page",
      media_type: "text/html; charset=utf-8",
      size_bytes: 42,
      created_at: new Date("2026-07-19T01:00:00.000Z"),
      updated_at: new Date("2026-07-19T02:00:00.000Z"),
    },
    direct_path: "/Alice/notes",
    preview: {
      kind: "html",
      document: "<!doctype html><script>throw 'blocked'</script><p>Creator</p>",
    },
    default_page: {
      label: "Default page",
      direct_path: "/Alice",
      site_path: "/site/Alice",
    },
    other_pages: [{
      label: "about",
      direct_path: "/Alice/about",
      site_path: "/site/Alice/about",
    }],
    has_more_public_pages: false,
  };
  const html = render_to_string(
    <PublicPageViewPage navigation={navigation} view={view} />,
  );
  assertStringIncludes(html, "sandbox");
  assertStringIncludes(html, "srcdoc=");
  assertStringIncludes(html, 'href="/Alice/notes"');
  assertStringIncludes(html, 'href="/site/Alice"');
  assertStringIncludes(html, 'href="/site/Alice/about"');
  assertStringIncludes(html, "Creator content");
});

Deno.test("public page wrapper renders a non-disclosing missing view", () => {
  const html = render_to_string(
    <PublicPageViewPage navigation={navigation} view={{ kind: "missing" }} />,
  );
  assertStringIncludes(html, "That page was not found");
  assertStringIncludes(html, "missing or is not available");
});
