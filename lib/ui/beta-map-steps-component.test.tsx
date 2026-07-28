import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import BetaMapRouteSteps from "../../islands/BetaMapRouteSteps.tsx";
import {
  beta_expand_endpoint,
  beta_map_steps_markdown,
} from "./beta-preview.ts";

function render(markdown: string): string {
  return render_to_string(
    <BetaMapRouteSteps
      initial_markdown={markdown}
      expand_endpoint={beta_expand_endpoint}
    />,
  );
}

Deno.test("a map link renders as a framed step with a pin and ordered stops", () => {
  const html = render(
    "[Weekend](https://www.google.com/maps/dir/?api=1&origin=Lviv&destination=Uzhhorod&waypoints=Stryi)",
  );
  assertStringIncludes(html, "beta-step beta-map-step");
  assertStringIncludes(html, "google-maps-pin");
  assertStringIncludes(html, "Google Maps route");
  assertStringIncludes(html, 'data-beta-stop-index="0"');
  assertStringIncludes(html, 'data-beta-stop-index="2"');
  assertStringIncludes(html, "Lviv");
  assertStringIncludes(html, "Stryi");
  assertStringIncludes(html, "Uzhhorod");
  assertStringIncludes(html, "Origin");
  assertStringIncludes(html, "Destination");
  assertStringIncludes(html, "Split out");
  assertStringIncludes(html, "Open route");
});

Deno.test("a place link frames one stop and offers framing by drag", () => {
  const html = render("[Zoo](https://maps.google.com/?q=Kyiv+Zoo)");
  assertStringIncludes(html, 'data-beta-step-index="0"');
  assertStringIncludes(html, "Drag between steps to reorder, or onto another");
  assertStringIncludes(html, "Kyiv Zoo");
  // A single stop cannot be split out of its own frame.
  assertStringIncludes(html, "disabled");
});

Deno.test("non-map sections stay plain, undecorated steps", () => {
  const html = render("## Trip draft\n[Docs](https://example.com)");
  assertEquals(html.includes("beta-step beta-map-step"), false);
  assertEquals(html.includes("google-maps-pin"), false);
  assertStringIncludes(html, "beta-step-raw");
  assertStringIncludes(html, "## Trip draft");
});

Deno.test("the starting draft renders every step of the preview", () => {
  const html = render(beta_map_steps_markdown);
  const steps = html.match(/data-beta-step-index="/g) ?? [];
  assertEquals(steps.length, beta_map_steps_markdown.split("\n").length);
  assertStringIncludes(html, "Your location");
  assertStringIncludes(html, "Add map step");
  assertStringIncludes(html, "Travel mode");
});
