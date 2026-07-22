import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import PageManagementPanel from "../../islands/PageManagementPanel.tsx";

Deno.test("creator management component renders controls and safe rows", () => {
  const html = render_to_string(
    <PageManagementPanel
      csrf_token={"c".repeat(43)}
      owned_namespaces={["Mine"]}
      initial_pages={[{
        page_id: "page-1",
        locator: { namespace: "Mine", page_name: "notes" },
        path: "/Mine/notes",
        endpoints: {
          canonical: {
            locator: { namespace: "Mine", page_name: "notes" },
            path: "/Mine/notes",
            delivery_profile: "inline",
          },
          alternates: [{
            locator: { namespace: "Mine", page_name: "notes-copy" },
            path: "/Mine/notes-copy",
            delivery_profile: "inline",
          }],
        },
        access: "private",
        content_type: "md-page",
        size_bytes: 42,
        tags: ["notes", "work"],
        updated_at: "2026-07-20T01:00:00.000Z",
        revision: 2,
        etag: '"page-page-1-r2"',
        management_url: "/api/pages/page-1",
      }]}
      initial_next_cursor="next"
    />,
  );

  assertStringIncludes(html, "Apply filters");
  assertStringIncludes(html, 'placeholder="contains…"');
  assertStringIncludes(html, "Exact tag");
  assertStringIncludes(html, "External content unavailable");
  assertStringIncludes(html, "0 selected");
  assertStringIncludes(html, "Apply access");
  assertStringIncludes(html, "Delete selected");
  assertStringIncludes(html, "Select /Mine/notes");
  assertStringIncludes(html, "tags: notes, work");
  assertStringIncludes(html, "inline: /Mine/notes-copy");
  assertStringIncludes(html, "Rename");
  assertStringIncludes(html, "Edit paths");
  assertEquals(html.includes(">Duplicate<"), false);
  assertStringIncludes(html, "Make public");
  assertStringIncludes(html, "Load more pages");
  assertEquals(html.includes("csrf_token"), false);
  assertEquals(html.includes("owner_user_id"), false);
});

Deno.test("creator management component warns owners and presents repairs", () => {
  const html = render_to_string(
    <PageManagementPanel
      csrf_token={"c".repeat(43)}
      owned_namespaces={["Mine"]}
      initial_pages={[{
        page_id: "broken-1",
        locator: { namespace: "Mine", page_name: "broken" },
        path: "/Mine/broken",
        endpoints: {
          canonical: {
            locator: { namespace: "Mine", page_name: "broken" },
            path: "/Mine/broken",
            delivery_profile: "inline",
          },
          alternates: [],
        },
        access: "public",
        content_type: "md-page",
        size_bytes: 42,
        tags: [],
        updated_at: "2026-07-22T01:00:00.000Z",
        revision: 1,
        etag: '"page-broken-1-r1"',
        management_url: "/api/pages/broken-1",
        external_missing: {
          cause: "connection_revoked",
          detected_at: "2026-07-22T02:00:00.000Z",
        },
      }]}
      initial_next_cursor={null}
    />,
  );

  assertStringIncludes(html, "External content is unavailable");
  assertStringIncludes(html, "The storage connection was revoked.");
  assertStringIncludes(html, "Visitors see a temporary placeholder.");
  assertStringIncludes(html, "Re-link external file");
  assertStringIncludes(html, "Replace inline and detach");
  assertEquals(html.includes("connection_id"), false);
});

Deno.test("creator management component presents PDF preview and download actions", () => {
  const html = render_to_string(
    <PageManagementPanel
      csrf_token={"c".repeat(43)}
      owned_namespaces={["Mine"]}
      initial_pages={[{
        page_id: "pdf-1",
        locator: { namespace: "Mine", page_name: "report" },
        path: "/Mine/report",
        endpoints: {
          canonical: {
            locator: { namespace: "Mine", page_name: "report" },
            path: "/Mine/report",
            delivery_profile: "inline",
          },
          alternates: [{
            locator: { namespace: "Mine", page_name: "report-download" },
            path: "/Mine/report-download",
            delivery_profile: "attachment",
          }],
        },
        access: "private",
        content_type: "pdf",
        size_bytes: 2048,
        tags: ["reports"],
        updated_at: "2026-07-21T01:00:00.000Z",
        revision: 3,
        etag: '"page-pdf-1-r3"',
        management_url: "/api/pages/pdf-1",
      }]}
      initial_next_cursor={null}
    />,
  );

  assertStringIncludes(html, "delivery paths");
  assertStringIncludes(html, 'href="/Mine/report"');
  assertStringIncludes(html, "Open PDF: /Mine/report");
  assertStringIncludes(html, 'href="/Mine/report-download"');
  assertStringIncludes(html, "Download PDF: /Mine/report-download");
  assertStringIncludes(html, "Inspect PDF");
  assertEquals(html.includes(">Duplicate<"), false);
  assertEquals(html.includes("application/pdf"), false);
});
