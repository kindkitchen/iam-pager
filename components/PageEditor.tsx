import { useEffect, useState } from "preact/hooks";
import type { PagePreviewer } from "../lib/ui/page-preview.ts";
import { MarkdownContentEditor } from "./MarkdownContentEditor.tsx";
import {
  default_page_style_preset,
  page_style_presets,
} from "../lib/ui/page-style-presets.ts";

export interface PageEditorProps {
  markdown: string;
  css: string;
  on_markdown_input: (value: string) => void;
  on_css_input: (value: string) => void;
  previewer: PagePreviewer;
}

type EditorView = "all" | "preview" | "css";

const views: readonly { id: EditorView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "preview", label: "Preview" },
  { id: "css", label: "CSS" },
];

export function PageEditor(props: PageEditorProps) {
  const [view, set_view] = useState<EditorView>("all");
  const [preset_id, set_preset_id] = useState(default_page_style_preset.id);
  const [preview_document, set_preview_document] = useState("");
  const [preview_message, set_preview_message] = useState(
    "Add Markdown to start the live preview.",
  );
  const show_markdown = view === "all";
  const show_css = view === "all" || view === "css";
  const show_preview = view === "all" || view === "preview";

  useEffect(() => {
    if (!show_preview || props.markdown.trim() === "") {
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
  }, [props.markdown, props.css, props.previewer, show_preview]);

  function apply_preset(id: string) {
    set_preset_id(id);
    const preset = page_style_presets.find((candidate) => candidate.id === id);
    props.on_css_input(preset?.css ?? "");
  }

  function update_css(value: string) {
    set_preset_id("");
    props.on_css_input(value);
  }

  return (
    <section class="page-editor" aria-labelledby="page-editor-heading">
      <div class="page-editor-heading">
        <div>
          <span class="field-title" id="page-editor-heading">Page</span>
          <small>Markdown is sanitized before publishing.</small>
        </div>
        <div class="view-switcher" role="group" aria-label="Page editor view">
          {views.map((option) => (
            <button
              type="button"
              class="view-button"
              aria-pressed={view === option.id}
              onClick={() => set_view(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div class={`page-editor-areas page-editor-${view}`}>
        <MarkdownContentEditor
          markdown={props.markdown}
          active={show_markdown}
          on_markdown_input={props.on_markdown_input}
        />

        {show_css && (
          <div class="editor-area css-area">
            <div class="css-heading">
              <label for="style-preset">CSS</label>
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
            <textarea
              name="css"
              aria-label="CSS"
              rows={15}
              maxLength={16 * 1024}
              value={props.css}
              onInput={(event) => update_css(event.currentTarget.value)}
              placeholder="body { max-width: 48rem; margin: 3rem auto; }"
            />
            <small>Up to 16 KiB. Choosing a preset replaces all CSS.</small>
          </div>
        )}

        {show_preview && (
          <section class="editor-area preview-area" aria-label="Live preview">
            <span class="field-title">Preview</span>
            <iframe
              title="Live page preview"
              sandbox=""
              srcdoc={preview_document}
            />
            <small aria-live="polite">{preview_message}</small>
          </section>
        )}
      </div>
    </section>
  );
}
