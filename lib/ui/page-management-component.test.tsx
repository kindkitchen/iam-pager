import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import PageManagementPanel from "../../islands/PageManagementPanel.tsx";

Deno.test("creator management component renders DS-MANAGE controls and safe rows", () => {
  const html = render_to_string(
    <PageManagementPanel
      csrf_token={"c".repeat(43)}
      initial_pages={[{
        page_id: "page-1",
        locator: { namespace: "Mine", page_name: "notes" },
        path: "/Mine/notes",
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
  assertStringIncludes(html, "0 selected");
  assertStringIncludes(html, "Apply access");
  assertStringIncludes(html, "Delete selected");
  assertStringIncludes(html, "Select /Mine/notes");
  assertStringIncludes(html, "tags: notes, work");
  assertStringIncludes(html, "Rename");
  assertStringIncludes(html, "Duplicate");
  assertStringIncludes(html, "Make public");
  assertStringIncludes(html, "Load more pages");
  assertEquals(html.includes("csrf_token"), false);
  assertEquals(html.includes("owner_user_id"), false);
});
