import { assertEquals, assertThrows } from "@std/assert";
import {
  current_location_label,
  DeterministicMapRouteStepEditor,
  is_map_step_section,
} from "./map-route-steps.ts";
import { DeterministicMarkdownSectionEditor } from "./markdown-section-editor.ts";

const editor = new DeterministicMapRouteStepEditor();
const sections = new DeterministicMarkdownSectionEditor();

function section(markdown: string) {
  return sections.parse(markdown)[0];
}

Deno.test("a place link reads as a one-stop frame", () => {
  const step = editor.read(
    section("[Zoo](https://www.google.com/maps/search/?api=1&query=Kyiv+Zoo)"),
  );
  assertEquals(step?.stops.map((stop) => stop.label), ["Kyiv Zoo"]);
  assertEquals(step?.label, "Zoo");
  assertEquals(
    editor.url(step!),
    "https://www.google.com/maps/dir/?api=1&destination=Kyiv+Zoo",
  );
});

Deno.test("a route link reads as its ordered stops, current location included", () => {
  const step = editor.read(
    section(
      "[Trip](https://www.google.com/maps/dir/?api=1&destination=Lviv&waypoints=Rivne&travelmode=transit)",
    ),
  );
  assertEquals(step?.stops.map((stop) => stop.label), [
    current_location_label,
    "Rivne",
    "Lviv",
  ]);
  assertEquals(step?.travel_mode, "transit");
});

Deno.test("a derived label is not stored, a custom one is", () => {
  const derived = editor.read(
    section(
      "[Kyiv → Lviv](https://www.google.com/maps/dir/?api=1&origin=Kyiv&destination=Lviv)",
    ),
  );
  assertEquals(derived?.label, null);
  assertEquals(editor.label(derived!), "Kyiv → Lviv");

  const custom = editor.read(
    section(
      "[Weekend](https://www.google.com/maps/dir/?api=1&origin=Kyiv&destination=Lviv)",
    ),
  );
  assertEquals(custom?.label, "Weekend");
});

Deno.test("non-maps links and other sections are not map steps", () => {
  assertEquals(editor.read(section("[Docs](https://example.com)")), null);
  assertEquals(editor.read(section("plain text")), null);
  assertEquals(
    is_map_step_section(section("[Zoo](https://maps.google.com/?q=Kyiv+Zoo)")),
    true,
  );
});

Deno.test("short links stay plain links until they are expanded", () => {
  assertEquals(
    editor.read(section("[Spot](https://maps.app.goo.gl/abc123)")),
    null,
  );
});

Deno.test("dropping one frame on another keeps points, never merges text", () => {
  const first = editor.read(section("[A](https://maps.google.com/?q=A)"))!;
  const second = editor.read(section("[B](https://maps.google.com/?q=B)"))!;
  const merged = editor.merge(first, second);
  assertEquals(merged.stops.map((stop) => stop.label), ["A", "B"]);
  assertEquals(
    editor.url(merged),
    "https://www.google.com/maps/dir/?api=1&origin=A&destination=B",
  );
  assertEquals(editor.label(merged), "A → B");
});

Deno.test("frames merge at a chosen position and collapse repeats", () => {
  const target = editor.read(
    section(
      "[t](https://www.google.com/maps/dir/?api=1&origin=A&destination=C)",
    ),
  )!;
  const source = editor.read(section("[s](https://maps.google.com/?q=B)"))!;
  assertEquals(
    editor.merge(target, source, 1).stops.map((stop) => stop.label),
    ["A", "B", "C"],
  );
  const tail = editor.read(
    section(
      "[s](https://www.google.com/maps/dir/?api=1&origin=C&destination=D)",
    ),
  )!;
  // A→C followed by C→D is one trip through C, not two stops at C.
  assertEquals(
    editor.merge(target, tail).stops.map((stop) => stop.label),
    ["A", "C", "D"],
  );
});

Deno.test("stops reorder top to bottom and the URL follows", () => {
  const step = editor.read(
    section(
      "[t](https://www.google.com/maps/dir/?api=1&origin=A&destination=C&waypoints=B)",
    ),
  )!;
  const moved = editor.move_stop(step, 2, 0);
  assertEquals(moved.stops.map((stop) => stop.label), ["C", "A", "B"]);
  assertEquals(
    editor.url(moved),
    "https://www.google.com/maps/dir/?api=1&origin=C&destination=B&waypoints=A",
  );
});

Deno.test("a stop splits out of the frame as its own step", () => {
  const step = editor.read(
    section(
      "[t](https://www.google.com/maps/dir/?api=1&origin=A&destination=C&waypoints=B)",
    ),
  )!;
  const split = editor.extract_stop(step, 1);
  assertEquals(split.extracted.stops.map((stop) => stop.label), ["B"]);
  assertEquals(split.remaining?.stops.map((stop) => stop.label), ["A", "C"]);

  const last = editor.extract_stop(split.extracted, 0);
  assertEquals(last.remaining, null);
});

Deno.test("a rendered map step stays a Markdown link and keeps its list marker", () => {
  const original = section("- [Old](https://maps.google.com/?q=A)");
  const step = editor.read(original)!;
  const next = editor.section(
    editor.set_label(
      editor.merge(
        step,
        editor.read(section("[B](https://maps.google.com/?q=B)"))!,
      ),
      "Tour",
    ),
    original,
  );
  assertEquals(
    next.raw,
    "- [Tour](https://www.google.com/maps/dir/?api=1&origin=A&destination=B)",
  );
  assertEquals(next.type, "link");
});

Deno.test("clearing a custom label falls back to the derived one", () => {
  const step = editor.read(section("[Trip](https://maps.google.com/?q=A)"))!;
  assertEquals(editor.set_label(step, "  ").label, null);
  assertEquals(editor.label(editor.set_label(step, "A")), "A");
});

Deno.test("travel mode is part of the generated link", () => {
  const step = editor.read(section("[A](https://maps.google.com/?q=A)"))!;
  assertEquals(
    editor.url(editor.set_travel_mode(step, "walking")),
    "https://www.google.com/maps/dir/?api=1&destination=A&travelmode=walking",
  );
});

Deno.test("warnings explain the current-location and destination limits", () => {
  const step = editor.read(
    section("[t](https://www.google.com/maps/dir/?api=1&destination=B)"),
  )!;
  assertEquals(editor.warnings(step), []);
  const moved = editor.move_stop(step, 0, 1);
  assertEquals(moved.stops.map((stop) => stop.label), [
    "B",
    current_location_label,
  ]);
  assertEquals(editor.warnings(moved).length, 1);

  const alone = editor.remove_stop(moved, 0)!;
  assertEquals(editor.can_generate(alone), false);
  assertEquals(editor.warnings(alone), [
    "Add a place: a route needs at least one destination.",
  ]);
});

Deno.test("stop indexes are validated", () => {
  const step = editor.read(section("[A](https://maps.google.com/?q=A)"))!;
  assertThrows(() => editor.move_stop(step, 0, 3), RangeError);
});

Deno.test("pasted values become stops, unusable ones become none", () => {
  assertEquals(
    editor.stops_from_value(
      "https://www.google.com/maps/dir/?api=1&origin=A&destination=B",
    )
      .map((stop) => stop.label),
    ["A", "B"],
  );
  assertEquals(editor.stops_from_value("50.45,30.52")[0].label, "50.45, 30.52");
  assertEquals(editor.stops_from_value("https://maps.app.goo.gl/x").length, 0);
});
