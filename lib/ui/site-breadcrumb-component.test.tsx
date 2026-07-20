import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { SiteBreadcrumb } from "../../components/SiteBreadcrumb.tsx";
import { site_breadcrumb_presenter } from "./site-breadcrumb.ts";

Deno.test("breadcrumb renders back links and marks the current step", () => {
  const html = render_to_string(
    <SiteBreadcrumb
      trail={site_breadcrumb_presenter.present({ kind: "manage" })}
    />,
  );
  assertStringIncludes(html, 'aria-label="Breadcrumb"');
  assertStringIncludes(html, 'href="/site"');
  assertStringIncludes(html, "Manage pages");
  assertStringIncludes(html, 'aria-current="page"');
});

Deno.test("home breadcrumb offers no link and no stale current marker", () => {
  const html = render_to_string(
    <SiteBreadcrumb
      trail={site_breadcrumb_presenter.present({ kind: "home" })}
    />,
  );
  assertEquals(html.includes("href="), false);
  assertStringIncludes(html, 'aria-current="page"');
});
