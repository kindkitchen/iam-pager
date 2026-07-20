import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import PagePublishForm from "../../islands/PagePublishForm.tsx";

Deno.test("publish form starts with model-backed Markdown and PDF choices", () => {
  const html = render_to_string(
    <PagePublishForm
      initial_namespace="quiet-river"
      authorization={{ kind: "guest" }}
    />,
  );

  assertStringIncludes(html, "Markdown page");
  assertStringIncludes(html, "PDF document");
  assertStringIncludes(html, 'value="md-page" checked');
  assertStringIncludes(html, "Write. Style. Preview. Publish.");
  assertEquals(html.includes('type="file"'), false);
});

Deno.test("PDF publish view renders bounded picker and explicit endpoint profiles", () => {
  const html = render_to_string(
    <PagePublishForm
      initial_namespace="quiet-river"
      initial_content_type="pdf"
      authorization={{ kind: "guest" }}
    />,
  );

  assertStringIncludes(html, 'value="pdf" checked');
  assertStringIncludes(html, "Canonical endpoint");
  assertStringIncludes(html, 'type="file"');
  assertStringIncludes(html, 'accept="application/pdf,.pdf"');
  assertStringIncludes(html, "Choose a PDF up to 16 MiB.");
  assertStringIncludes(html, "Alternate endpoint");
  assertStringIncludes(html, "No path suffix is inferred.");
  assertStringIncludes(html, 'id="canonical-delivery-profile"');
  assertStringIncludes(html, 'id="alternate-delivery-profile"');
  assertStringIncludes(html, "Open in browser");
  assertStringIncludes(html, "Download attachment");
  assertEquals(html.includes("Write. Style. Preview. Publish."), false);
});
