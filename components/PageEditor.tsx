import { useEffect, useRef, useState } from "preact/hooks";
import {
  DeterministicEditorWorkspace,
  type EditorLayout,
  type EditorSource,
} from "../lib/ui/editor-workspace.ts";
import type { PagePreviewer } from "../lib/ui/page-preview.ts";
import {
  default_page_style_preset,
  page_style_presets,
} from "../lib/ui/page-style-presets.ts";
import { CssSourceEditor } from "./CssSourceEditor.tsx";
import { MarkdownContentEditor } from "./MarkdownContentEditor.tsx";

export interface PageEditorProps {
  markdown: string;
  css: string;
  on_markdown_input: (value: string) => void;
  on_css_input: (value: string) => void;
  previewer: PagePreviewer;
}

const workspace_controller = new DeterministicEditorWorkspace();

const source_options: readonly { id: EditorSource; label: string }[] = [
  { id: "markdown", label: "Markdown" },
  { id: "css", label: "CSS" },
];

const layout_options: readonly { id: EditorLayout; label: string }[] = [
  { id: "split", label: "Split with preview" },
  { id: "full-width", label: "Full width" },
];

export function PageEditor(props: PageEditorProps) {
  const [workspace, set_workspace] = useState(
    workspace_controller.initial_state(),
  );
  const [preset_id, set_preset_id] = useState(default_page_style_preset.id);
  const [preview_document, set_preview_document] = useState("");
  const [preview_message, set_preview_message] = useState(
    "Add Markdown to start the live preview.",
  );
  const [preview_fullscreen, set_preview_fullscreen] = useState(false);
  const preview_area_ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (props.markdown.trim() === "") {
      set_preview_document("");
      set_preview_message("Add Markdown to start the live preview.");
      return;
    }

    const timer = setTimeout(() => {
      set_preview_message("Updating preview…");
      try {
        const document = props.previewer.render({
          md: props.markdown,
          ...(props.css === "" ? {} : { css: props.css }),
        });
        set_preview_document(document);
        set_preview_message("Preview is up to date.");
      } catch (error) {
        set_preview_document("");
        set_preview_message(
          error instanceof Error ? error.message : "Preview failed",
        );
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [props.markdown, props.css, props.previewer]);

  useEffect(() => {
    function update_fullscreen_state() {
      set_preview_fullscreen(
        globalThis.document.fullscreenElement === preview_area_ref.current,
      );
    }

    globalThis.document.addEventListener(
      "fullscreenchange",
      update_fullscreen_state,
    );
    return () =>
      globalThis.document.removeEventListener(
        "fullscreenchange",
        update_fullscreen_state,
      );
  }, []);

  function apply_preset(id: string) {
    set_preset_id(id);
    const preset = page_style_presets.find((candidate) => candidate.id === id);
    props.on_css_input(preset?.css ?? "");
  }

  function update_css(value: string) {
    set_preset_id("");
    props.on_css_input(value);
  }

  async function toggle_preview_fullscreen() {
    const preview_area = preview_area_ref.current;
    if (!preview_area) return;

    try {
      if (globalThis.document.fullscreenElement === preview_area) {
        await globalThis.document.exitFullscreen();
      } else {
        await preview_area.requestFullscreen();
      }
    } catch (error) {
      set_preview_message(
        error instanceof Error
          ? `Fullscreen unavailable: ${error.message}`
          : "Fullscreen is unavailable.",
      );
    }
  }

  return (
    <section class="page-editor" aria-labelledby="page-editor-heading">
      <div class="page-editor-heading">
        <div>
          <span class="field-title" id="page-editor-heading">Page content</span>
          <small>Markdown is sanitized before publishing.</small>
        </div>
        <button
          type="button"
          class="context-button page-editor-toggle"
          aria-expanded={workspace.expanded}
          aria-controls="page-editor-workspace"
          onClick={() =>
            set_workspace((current) =>
              workspace_controller.set_expanded(
                current,
                !current.expanded,
              )
            )}
        >
          {workspace.expanded ? "Hide editor" : "Show editor"}
        </button>
      </div>

      <div
        id="page-editor-workspace"
        class="page-editor-workspace"
        hidden={!workspace.expanded}
      >
        <div class="page-editor-toolbar">
          <div
            class="source-switcher contextual-switcher"
            role="group"
            aria-label="Source editor"
          >
            {source_options.map((option) => (
              <button
                type="button"
                class="context-button"
                aria-pressed={workspace.source === option.id}
                onClick={() =>
                  set_workspace((current) =>
                    workspace_controller.select_source(current, option.id)
                  )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div
            class="layout-switcher contextual-switcher"
            role="group"
            aria-label="Editor layout"
          >
            {layout_options.map((option) => (
              <button
                type="button"
                class="context-button"
                aria-pressed={workspace.layout === option.id}
                onClick={() =>
                  set_workspace((current) =>
                    workspace_controller.select_layout(current, option.id)
                  )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div class={`page-editor-areas editor-layout-${workspace.layout}`}>
          <MarkdownContentEditor
            markdown={props.markdown}
            css={props.css}
            active={workspace.expanded && workspace.source === "markdown"}
            on_markdown_input={props.on_markdown_input}
            previewer={props.previewer}
          />

          <fieldset
            class="editor-area css-area"
            disabled={!workspace.expanded || workspace.source !== "css"}
            hidden={workspace.source !== "css"}
          >
            <div class="css-heading">
              <label for="style-preset">Style preset</label>
              <select
                id="style-preset"
                aria-label="Replace CSS with preset"
                value={preset_id}
                onChange={(event) => apply_preset(event.currentTarget.value)}
              >
                <option value="">Blank</option>
                {page_style_presets.map((preset) => (
                  <option value={preset.id}>{preset.label}</option>
                ))}
              </select>
            </div>
            <CssSourceEditor
              value={props.css}
              max_length={16 * 1024}
              on_input={update_css}
            />
            <small>Up to 16 KiB. Choosing a preset replaces all CSS.</small>
          </fieldset>

          <section
            ref={preview_area_ref}
            class="editor-area preview-area"
            aria-label="Live preview"
            data-fullscreen={preview_fullscreen}
          >
            <div class="preview-heading">
              <span class="field-title">Preview</span>
              <button
                type="button"
                class="context-button preview-fullscreen-button"
                aria-pressed={preview_fullscreen}
                onClick={toggle_preview_fullscreen}
              >
                {preview_fullscreen ? "Exit full screen" : "Full screen"}
              </button>
            </div>
            <iframe
              title="Live page preview"
              sandbox=""
              srcdoc={preview_document}
            />
            <small aria-live="polite">{preview_message}</small>
          </section>
        </div>
      </div>
    </section>
  );
}
