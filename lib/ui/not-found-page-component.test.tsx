import { assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { NotFoundPage } from "../../components/NotFoundPage.tsx";

Deno.test("not-found page offers exploration as the primary destination", () => {
  const html = render_to_string(<NotFoundPage />);

  assertStringIncludes(html, "This page wandered off.");
  assertStringIncludes(html, 'href="/site/explore"');
  assertStringIncludes(html, "Explore public pages");
  assertStringIncludes(html, 'href="/site"');
});
