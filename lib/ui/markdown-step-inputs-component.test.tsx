import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { MarkdownContentEditor } from "../../components/MarkdownContentEditor.tsx";
import { ClientPagePreviewer } from "./page-preview.ts";
import {
  default_step_editor_config,
  link_variant_simple,
  set_step_input_enabled,
  set_step_input_variant,
  type StepEditorConfig,
} from "./step-editor-config.ts";

function render(config?: StepEditorConfig): string {
  return render_to_string(
    <MarkdownContentEditor
      panel_id="source-markdown-panel"
      label_id="source-markdown-button"
      markdown="[Trip](https://maps.google.com/?q=Kyiv+Zoo)"
      css=""
      active
      on_markdown_input={() => {}}
      previewer={new ClientPagePreviewer()}
      {...(config ? { initial_step_config: config } : {})}
    />,
  );
}

Deno.test("the editor keeps Raw as its landing mode", () => {
  const html = render();
  assertStringIncludes(html, 'aria-label="Raw Markdown"');
  // The step-input line belongs to Steps mode only.
  assertEquals(html.includes("markdown-step-extensions"), false);
});

Deno.test("the step-input configuration is accepted as JSON initial state", () => {
  const config = set_step_input_variant(
    set_step_input_enabled(default_step_editor_config(), "code-block", false),
    "link",
    link_variant_simple,
  );
  const restored = JSON.parse(JSON.stringify(config)) as StepEditorConfig;
  const html = render(restored);
  assertStringIncludes(html, "markdown-mode-steps-button");
  assertEquals(html.includes("Discard"), false);
});
