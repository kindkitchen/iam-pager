import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  beta_expand_endpoint,
  beta_map_steps_preview,
} from "./beta-preview.ts";
import { map_route_step_editor } from "./map-route-steps.ts";
import { DeterministicMarkdownSectionEditor } from "./markdown-section-editor.ts";

Deno.test("the preview echoes the requested beta path", () => {
  const view = beta_map_steps_preview(
    new URL("https://pager.test/beta/map/steps?x=1"),
  );
  assertEquals(view.path, "/beta/map/steps");
  assertEquals(view.expand_endpoint, beta_expand_endpoint);
  assertStringIncludes(view.summary, "shipped editor is untouched");
});

Deno.test("the starting draft carries loose, plain, and framed steps", () => {
  const view = beta_map_steps_preview(new URL("https://pager.test/beta"));
  const sections = new DeterministicMarkdownSectionEditor().parse(
    view.markdown,
  );
  const steps = sections.map((section) => map_route_step_editor.read(section));
  const framed = steps.filter((step) => step !== null);

  assertEquals(framed.length, 4);
  assertEquals(framed.filter((step) => step!.stops.length === 1).length, 2);
  assertEquals(
    framed.find((step) => step!.stops.length === 3)!.stops.map((stop) =>
      stop.label
    ),
    ["Lviv", "Stryi", "Uzhhorod"],
  );
  // One framed route starts from the device position, as Maps resolves it.
  assertEquals(
    framed.some((step) => step!.stops[0].point.kind === "current_location"),
    true,
  );
  assertEquals(steps.filter((step) => step === null).length > 0, true);
});
