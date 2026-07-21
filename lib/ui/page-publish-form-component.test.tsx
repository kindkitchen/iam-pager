import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import PagePublishForm from "../../islands/PagePublishForm.tsx";

Deno.test("guest publish form keeps free-text namespace and optional aliases", () => {
  const html = render_to_string(
    <PagePublishForm
      initial_namespace="quiet-river"
      authorization={{ kind: "guest" }}
    />,
  );

  assertStringIncludes(html, "Markdown page");
  assertStringIncludes(html, "PDF document");
  assertStringIncludes(html, 'value="md-page" checked');
  assertStringIncludes(html, 'value="quiet-river"');
  assertStringIncludes(html, "Optional aliases");
  assertStringIncludes(html, "Add alias");
  assertStringIncludes(html, "Aliases do not copy content");
  assertStringIncludes(html, "Write. Style. Preview. Publish.");
  assertEquals(html.includes('type="file"'), false);
});

Deno.test("PDF publish starts with one path and a downloadable checkbox", () => {
  const html = render_to_string(
    <PagePublishForm
      initial_namespace="quiet-river"
      initial_content_type="pdf"
      authorization={{ kind: "guest" }}
    />,
  );

  assertStringIncludes(html, 'value="pdf" checked');
  assertStringIncludes(html, "Primary path");
  assertStringIncludes(html, 'type="file"');
  assertStringIncludes(html, 'accept="application/pdf,.pdf"');
  assertStringIncludes(html, "Choose a PDF up to 16 MiB.");
  assertStringIncludes(html, 'type="checkbox"');
  assertStringIncludes(html, "Downloadable");
  assertStringIncludes(html, "Add an alias");
  assertEquals(html.includes("Alternate endpoint"), false);
  assertEquals(html.includes("Write. Style. Preview. Publish."), false);
});

Deno.test("creator publishing selects owned namespaces and blocks an empty owner", () => {
  const creator_html = render_to_string(
    <PagePublishForm
      initial_namespace="ignored-random"
      authorization={{
        kind: "creator",
        csrf_token: "csrf",
        owned_namespaces: ["Alice", "Knowledge"],
      }}
    />,
  );
  assertStringIncludes(creator_html, '<select id="namespace-primary"');
  assertStringIncludes(creator_html, 'value="Alice"');
  assertStringIncludes(creator_html, '<option value="Alice"');
  assertStringIncludes(creator_html, '<option value="Knowledge"');
  assertEquals(creator_html.includes("ignored-random"), false);

  const empty_html = render_to_string(
    <PagePublishForm
      initial_namespace="ignored-random"
      authorization={{
        kind: "creator",
        csrf_token: "csrf",
        owned_namespaces: [],
      }}
    />,
  );
  assertStringIncludes(
    empty_html,
    "Reserve a namespace before publishing a managed page.",
  );
  assertStringIncludes(empty_html, "No reserved namespaces");
  assertStringIncludes(empty_html, 'type="submit" disabled');
});
