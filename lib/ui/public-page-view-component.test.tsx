import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { PublicPageViewPage } from "../../components/PublicPageView.tsx";
import type { PublicPageView } from "./public-page-view.ts";
import type { SiteNavigation } from "./site-navigation.ts";

const navigation: SiteNavigation = {
  destinations: [
    { href: "/site", label: "Home", current: false },
    { href: "/site/explore", label: "Explore", current: false },
  ],
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
      endpoints: {
        canonical: {
          locator: { namespace: "Alice", page_name: "notes" },
          path: "/Alice/notes",
          delivery_profile: "inline",
        },
        alternates: [{
          locator: { namespace: "Alice", page_name: "notes-download" },
          path: "/Alice/notes-download",
          delivery_profile: "attachment",
        }],
      },
      stewardship: "managed",
      content_type: "md-page",
      media_type: "text/html; charset=utf-8",
      size_bytes: 42,
      tags: [],
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
  assertStringIncludes(html, 'href="/Alice/notes-download"');
  assertStringIncludes(html, "Open alternate attachment");
  assertStringIncludes(html, 'href="/site/Alice"');
  assertStringIncludes(html, 'href="/site/Alice/about"');
  assertStringIncludes(html, "Creator content");
});

Deno.test("public page wrapper embeds native PDF with persistent navigation and fallback", () => {
  const view: PublicPageView = {
    kind: "page",
    page: {
      locator: { namespace: "Alice", page_name: "report" },
      path: "/Alice/report",
      endpoints: {
        canonical: {
          locator: { namespace: "Alice", page_name: "report" },
          path: "/Alice/report",
          delivery_profile: "inline",
        },
        alternates: [{
          locator: { namespace: "Alice", page_name: "get-report" },
          path: "/Alice/get-report",
          delivery_profile: "attachment",
        }],
      },
      stewardship: "managed",
      content_type: "pdf",
      media_type: "application/pdf",
      size_bytes: 2048,
      tags: ["reports"],
      created_at: new Date("2026-07-19T01:00:00.000Z"),
      updated_at: new Date("2026-07-19T02:00:00.000Z"),
    },
    direct_path: "/Alice/report",
    preview: {
      kind: "pdf",
      preview: {
        locator: { namespace: "Alice", page_name: "report" },
        path: "/Alice/report",
        delivery_profile: "inline",
      },
      downloads: [{
        locator: { namespace: "Alice", page_name: "get-report" },
        path: "/Alice/get-report",
        delivery_profile: "attachment",
      }],
      size_bytes: 2048,
    },
    default_page: null,
    other_pages: [],
    has_more_public_pages: false,
  };

  const html = render_to_string(
    <PublicPageViewPage navigation={navigation} view={view} />,
  );

  assertStringIncludes(html, '<object aria-label="report PDF preview"');
  assertStringIncludes(html, 'data="/Alice/report"');
  assertStringIncludes(html, 'type="application/pdf"');
  assertStringIncludes(html, 'href="/site/explore">Back to public pages');
  assertStringIncludes(html, 'href="/Alice/report">Open PDF directly');
  assertStringIncludes(html, 'href="/Alice/get-report">Download PDF');
  assertStringIncludes(html, "This browser cannot display the PDF inline");
  assertStringIncludes(html, "Preview not visible?");
});

Deno.test("public page wrapper renders a download-only PDF without embedding", () => {
  const endpoint = {
    locator: { namespace: "Alice", page_name: "report" },
    path: "/Alice/report",
    delivery_profile: "attachment" as const,
  };
  const view: PublicPageView = {
    kind: "page",
    page: {
      locator: endpoint.locator,
      path: endpoint.path,
      endpoints: { canonical: endpoint, alternates: [] },
      stewardship: "managed",
      content_type: "pdf",
      media_type: "application/pdf",
      size_bytes: 2048,
      tags: [],
      created_at: new Date("2026-07-19T01:00:00.000Z"),
      updated_at: new Date("2026-07-19T02:00:00.000Z"),
    },
    direct_path: endpoint.path,
    preview: {
      kind: "pdf",
      preview: null,
      downloads: [endpoint],
      size_bytes: 2048,
    },
    default_page: null,
    other_pages: [],
    has_more_public_pages: false,
  };
  const html = render_to_string(
    <PublicPageViewPage navigation={navigation} view={view} />,
  );
  assertStringIncludes(html, "PDF available for download");
  assertStringIncludes(html, 'href="/Alice/report">Download PDF');
  assertEquals(html.includes("<object"), false);
});

Deno.test("public page wrapper renders a non-disclosing missing view", () => {
  const html = render_to_string(
    <PublicPageViewPage navigation={navigation} view={{ kind: "missing" }} />,
  );
  assertStringIncludes(html, "That page was not found");
  assertStringIncludes(html, "missing or is not available");
  assertStringIncludes(html, 'href="/site">Go home</a>');
});
