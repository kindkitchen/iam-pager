import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { MapRouteFields } from "../../components/MapRouteFields.tsx";
import { MarkdownStepExtensions } from "../../components/MarkdownStepExtensions.tsx";
import { map_route_step_editor } from "./map-route-steps.ts";
import {
  default_step_editor_config,
  link_variant_simple,
  set_step_input_enabled,
  set_step_input_variant,
} from "./step-editor-config.ts";

function frame(url: string, label = "Trip") {
  const step = map_route_step_editor.read_link(label, url)!;
  return render_to_string(
    <MapRouteFields step={step} id_prefix="edit-0" on_change={() => {}} />,
  );
}

Deno.test("a route frame lists ordered stops with roles and the pin", () => {
  const html = frame(
    "https://www.google.com/maps/dir/?api=1&origin=Lviv&destination=Uzhhorod&waypoints=Stryi",
  );
  assertStringIncludes(html, "google-maps-pin");
  assertStringIncludes(html, 'data-map-stop-index="0"');
  assertStringIncludes(html, 'data-map-stop-index="2"');
  assertStringIncludes(html, "Lviv");
  assertStringIncludes(html, "Stryi");
  assertStringIncludes(html, "Uzhhorod");
  assertStringIncludes(html, "Origin");
  assertStringIncludes(html, "Destination");
  assertStringIncludes(html, "Travel mode");
  assertStringIncludes(html, "Open route");
});

Deno.test("the current-location toggle reflects the leading stop", () => {
  const without = frame("https://maps.google.com/?q=Kyiv+Zoo");
  assertStringIncludes(without, "Start from your location");
  assertEquals(
    without.includes('id="edit-0-current-location" type="checkbox" checked'),
    false,
  );

  const with_current = frame(
    "https://www.google.com/maps/dir/?api=1&destination=Bukovel",
  );
  assertStringIncludes(with_current, "Your location");
  assertStringIncludes(
    with_current,
    'id="edit-0-current-location" type="checkbox" checked',
  );
});

Deno.test("a misplaced current location is explained in the frame", () => {
  const step = map_route_step_editor.read_link(
    "t",
    "https://www.google.com/maps/dir/?api=1&destination=B",
  )!;
  const html = render_to_string(
    <MapRouteFields
      step={map_route_step_editor.move_stop(step, 0, 1)}
      id_prefix="edit-0"
      on_change={() => {}}
    />,
  );
  assertStringIncludes(html, "only works as the first stop");
});

Deno.test("splitting is offered only when the surface accepts a new step", () => {
  const step = map_route_step_editor.read_link(
    "t",
    "https://www.google.com/maps/dir/?api=1&origin=A&destination=B",
  )!;
  const without = render_to_string(
    <MapRouteFields step={step} id_prefix="edit-0" on_change={() => {}} />,
  );
  assertEquals(without.includes("Split out"), false);

  const with_split = render_to_string(
    <MapRouteFields
      step={step}
      id_prefix="edit-0"
      on_change={() => {}}
      on_split_stop={() => {}}
    />,
  );
  assertStringIncludes(with_split, "Split out");
});

Deno.test("the extensions line renders a checkbox per input and a link select", () => {
  const html = render_to_string(
    <MarkdownStepExtensions
      config={default_step_editor_config()}
      on_change={() => {}}
    />,
  );
  for (const id of ["text", "heading", "link", "code-block", "raw"]) {
    assertStringIncludes(html, `id="step-input-${id}"`);
  }
  // Text is the input that can never be switched off.
  assertStringIncludes(
    html,
    'id="step-input-text" type="checkbox" checked disabled',
  );
  assertStringIncludes(html, "Simple + Map route");
  assertStringIncludes(html, 'aria-label="Link behaviour"');
});

Deno.test("a disabled input keeps its select inert", () => {
  const config = set_step_input_variant(
    set_step_input_enabled(default_step_editor_config(), "link", false),
    "link",
    link_variant_simple,
  );
  const html = render_to_string(
    <MarkdownStepExtensions config={config} on_change={() => {}} />,
  );
  assertEquals(
    html.includes('id="step-input-link" type="checkbox" checked'),
    false,
  );
  assertStringIncludes(html, 'class="markdown-step-extension-variant"');
  assertStringIncludes(html, "disabled");
});
