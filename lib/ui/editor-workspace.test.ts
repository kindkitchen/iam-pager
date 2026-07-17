import { assertEquals } from "@std/assert";
import { DeterministicEditorWorkspace } from "./editor-workspace.ts";

const controller = new DeterministicEditorWorkspace();

Deno.test("editor workspace starts expanded with Markdown beside preview", () => {
  assertEquals(controller.initial_state(), {
    expanded: true,
    source: "markdown",
    layout: "split",
  });
});

Deno.test("collapsing editor preserves source and layout choices", () => {
  let state = controller.initial_state();
  state = controller.select_source(state, "css");
  state = controller.select_layout(state, "full-width");
  state = controller.set_expanded(state, false);
  state = controller.set_expanded(state, true);

  assertEquals(state, {
    expanded: true,
    source: "css",
    layout: "full-width",
  });
});

Deno.test("source and layout choices change independently", () => {
  const initial = controller.initial_state();
  const with_css = controller.select_source(initial, "css");
  const full_width = controller.select_layout(with_css, "full-width");

  assertEquals(with_css, {
    expanded: true,
    source: "css",
    layout: "split",
  });
  assertEquals(full_width, {
    expanded: true,
    source: "css",
    layout: "full-width",
  });
});
