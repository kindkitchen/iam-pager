import { Fragment } from "preact";
import { useMemo, useState } from "preact/hooks";
import {
  DeterministicMarkdownLineEditor,
  markdown_heading_levels,
  type MarkdownHeadingLevel,
  type MarkdownLine,
  type MarkdownLineDraft,
  type MarkdownLineType,
} from "../lib/ui/markdown-line-editor.ts";

export interface MarkdownContentEditorProps {
  markdown: string;
  active: boolean;
  on_markdown_input: (value: string) => void;
}

type MarkdownEditorMode = "raw" | "steps";
type InsertableLineType = Exclude<MarkdownLineType, "raw">;

interface EditingState {
  index: number;
  draft: MarkdownLineDraft;
  dirty: boolean;
}

interface InsertionState {
  index: number;
  draft: MarkdownLineDraft | null;
  dirty: boolean;
}

const line_editor = new DeterministicMarkdownLineEditor();
const structured_line_limit = 500;

const line_type_labels: Readonly<Record<MarkdownLineType, string>> = {
  blank: "Blank",
  text: "Text",
  heading: "Heading",
  "bulleted-list": "Bulleted list",
  "numbered-list": "Numbered list",
  link: "Link",
  raw: "Markdown",
};

const insertion_options: readonly {
  type: InsertableLineType;
  label: string;
}[] = [
  { type: "text", label: "Text" },
  { type: "heading", label: "Heading" },
  { type: "bulleted-list", label: "Bulleted list" },
  { type: "numbered-list", label: "Numbered list" },
  { type: "link", label: "Link" },
  { type: "blank", label: "Blank line" },
];

const editable_type_options: readonly {
  type: MarkdownLineType;
  label: string;
}[] = [
  ...insertion_options,
  { type: "raw", label: "Raw Markdown" },
];

function new_draft(type: InsertableLineType): MarkdownLineDraft {
  switch (type) {
    case "blank":
      return { type };
    case "heading":
      return { type, level: 2, value: "" };
    case "link":
      return { type, label: "", url: "" };
    case "text":
    case "bulleted-list":
    case "numbered-list":
      return { type, value: "" };
  }
}

function MarkdownLinePreview(props: { line: MarkdownLine }) {
  const { line } = props;
  switch (line.type) {
    case "blank":
      return <span class="markdown-preview-blank" aria-hidden="true"></span>;
    case "heading":
      return (
        <span
          class="markdown-preview-heading"
          data-level={line.level}
        >
          {line.value || " "}
        </span>
      );
    case "bulleted-list":
    case "numbered-list":
      return (
        <span class="markdown-preview-list">
          <span class="markdown-preview-marker">{line.prefix.trim()}</span>
          <span>{line.value || " "}</span>
        </span>
      );
    case "link":
      return (
        <span class="markdown-preview-link">
          {line.label || line.url || " "}
        </span>
      );
    case "raw":
      return <code class="markdown-preview-raw">{line.value || " "}</code>;
    case "text":
      return <span>{line.value || " "}</span>;
  }
}

function normalize_pasted_value(value: string): string {
  return value.replace(/\r\n?|\n/g, " ");
}

interface MarkdownValueFieldProps {
  id: string;
  label: string;
  value: string;
  input_mode?: "url";
  placeholder?: string;
  on_change: (value: string) => void;
}

function MarkdownValueField(props: MarkdownValueFieldProps) {
  const [clipboard_message, set_clipboard_message] = useState("");

  function change(value: string) {
    set_clipboard_message("");
    props.on_change(value);
  }

  async function paste() {
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard) throw new Error("Clipboard access is unavailable.");
      change(normalize_pasted_value(await clipboard.readText()));
      set_clipboard_message("Pasted.");
    } catch {
      const pasted = globalThis.prompt(
        "Automatic clipboard access is blocked. Paste the value here, then choose OK.",
        "",
      );
      if (pasted === null) {
        set_clipboard_message(
          "Paste canceled. You can still paste directly into the field.",
        );
        return;
      }
      change(normalize_pasted_value(pasted));
      set_clipboard_message("Pasted using the manual fallback.");
    }
  }

  async function copy() {
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard) throw new Error("Clipboard access is unavailable.");
      await clipboard.writeText(props.value);
      set_clipboard_message("Copied.");
    } catch {
      set_clipboard_message(
        "Clipboard access was not allowed. Select and copy the field directly.",
      );
    }
  }

  return (
    <div class="markdown-value-field">
      <label for={props.id}>
        {props.label}
        <input
          id={props.id}
          type="text"
          inputMode={props.input_mode}
          value={props.value}
          placeholder={props.placeholder}
          onInput={(event) => change(event.currentTarget.value)}
        />
      </label>
      <div
        class="markdown-value-actions"
        role="group"
        aria-label={`${props.label} actions`}
      >
        <button type="button" class="compact-button" onClick={paste}>
          Paste
        </button>
        <button type="button" class="compact-button" onClick={copy}>
          Copy
        </button>
        <button type="button" class="compact-button" onClick={() => change("")}>
          Clear
        </button>
      </div>
      {clipboard_message && <small role="status">{clipboard_message}</small>}
    </div>
  );
}

function can_save(draft: MarkdownLineDraft): boolean {
  return draft.type !== "link" || draft.url.trim() !== "";
}

interface MarkdownDraftFieldsProps {
  draft: MarkdownLineDraft;
  id_prefix: string;
  on_change: (draft: MarkdownLineDraft) => void;
}

function MarkdownDraftFields(props: MarkdownDraftFieldsProps) {
  const { draft } = props;
  switch (draft.type) {
    case "blank":
      return <p class="markdown-blank-note">This adds one empty line.</p>;
    case "heading":
      return (
        <div class="markdown-heading-fields">
          <label for={`${props.id_prefix}-level`}>
            Level
            <select
              id={`${props.id_prefix}-level`}
              value={draft.level}
              onChange={(event) =>
                props.on_change({
                  ...draft,
                  level: Number(
                    event.currentTarget.value,
                  ) as MarkdownHeadingLevel,
                })}
            >
              {markdown_heading_levels.map((level) => (
                <option value={level}>H{level}</option>
              ))}
            </select>
          </label>
          <MarkdownValueField
            id={`${props.id_prefix}-value`}
            label="Heading"
            value={draft.value}
            on_change={(value) => props.on_change({ ...draft, value })}
          />
        </div>
      );
    case "link":
      return (
        <div class="markdown-link-fields">
          <MarkdownValueField
            id={`${props.id_prefix}-label`}
            label="Label"
            value={draft.label}
            on_change={(label) => props.on_change({ ...draft, label })}
          />
          <MarkdownValueField
            id={`${props.id_prefix}-url`}
            label="URL"
            input_mode="url"
            value={draft.url}
            placeholder="https://example.com"
            on_change={(url) => props.on_change({ ...draft, url })}
          />
        </div>
      );
    case "text":
    case "bulleted-list":
    case "numbered-list":
    case "raw":
      return (
        <MarkdownValueField
          id={`${props.id_prefix}-value`}
          label={line_type_labels[draft.type]}
          value={draft.value}
          on_change={(value) => props.on_change({ ...draft, value })}
        />
      );
  }
}

interface MarkdownTypeFieldProps {
  draft: MarkdownLineDraft;
  id_prefix: string;
  on_change: (draft: MarkdownLineDraft) => void;
}

function MarkdownTypeField(props: MarkdownTypeFieldProps) {
  return (
    <label for={`${props.id_prefix}-type`}>
      Type
      <select
        id={`${props.id_prefix}-type`}
        value={props.draft.type}
        onChange={(event) =>
          props.on_change(
            line_editor.change_type(
              props.draft,
              event.currentTarget.value as MarkdownLineType,
            ),
          )}
      >
        {editable_type_options.map((option) => (
          <option value={option.type}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

interface MarkdownInsertionProps {
  insertion: InsertionState;
  on_choose: (type: InsertableLineType) => void;
  on_change: (draft: MarkdownLineDraft) => void;
  on_save: () => void;
  on_cancel: () => void;
}

function MarkdownInsertion(props: MarkdownInsertionProps) {
  const { insertion } = props;
  return (
    <li class="markdown-insertion">
      <div class="markdown-insertion-heading">
        <strong>Add line {insertion.index + 1}</strong>
        <button
          type="button"
          class="compact-button"
          onClick={props.on_cancel}
        >
          Cancel
        </button>
      </div>
      <div class="markdown-type-picker" role="group" aria-label="Line type">
        {insertion_options.map((option) => (
          <button
            type="button"
            class="compact-button"
            aria-pressed={insertion.draft?.type === option.type}
            onClick={() => props.on_choose(option.type)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {insertion.draft && (
        <div class="markdown-line-form">
          <MarkdownDraftFields
            draft={insertion.draft}
            id_prefix={`insert-${insertion.index}`}
            on_change={props.on_change}
          />
          <button
            type="button"
            disabled={!can_save(insertion.draft)}
            onClick={props.on_save}
          >
            Add line
          </button>
        </div>
      )}
    </li>
  );
}

export function MarkdownContentEditor(props: MarkdownContentEditorProps) {
  const [mode, set_mode] = useState<MarkdownEditorMode>("raw");
  const [editing, set_editing] = useState<EditingState | null>(null);
  const [insertion, set_insertion] = useState<InsertionState | null>(null);
  const [delete_armed_index, set_delete_armed_index] = useState<number | null>(
    null,
  );
  const lines = useMemo(
    () => line_editor.parse(props.markdown),
    [props.markdown],
  );
  const line_limit_exceeded = lines.length > structured_line_limit;

  function has_unsaved_changes(): boolean {
    return editing?.dirty === true || insertion?.dirty === true;
  }

  function allow_discard(): boolean {
    return !has_unsaved_changes() || globalThis.confirm(
      "Discard the unsaved line changes?",
    );
  }

  function emit(lines: readonly MarkdownLine[]) {
    props.on_markdown_input(line_editor.serialize(lines));
  }

  function change_mode(next_mode: MarkdownEditorMode) {
    if (next_mode === mode || !allow_discard()) return;
    set_editing(null);
    set_insertion(null);
    set_delete_armed_index(null);
    set_mode(next_mode);
  }

  function toggle_edit(index: number) {
    if (editing?.index === index) {
      if (!allow_discard()) return;
      set_editing(null);
      set_delete_armed_index(null);
      return;
    }
    if (!allow_discard()) return;
    set_insertion(null);
    set_delete_armed_index(null);
    set_editing({
      index,
      draft: line_editor.draft(lines[index]),
      dirty: false,
    });
  }

  function begin_insert(index: number) {
    if (!allow_discard()) return;
    set_editing(null);
    set_delete_armed_index(null);
    set_insertion({ index, draft: null, dirty: false });
  }

  function choose_insertion_type(type: InsertableLineType) {
    set_insertion((current) =>
      current === null ? null : {
        ...current,
        draft: current.draft === null
          ? new_draft(type)
          : line_editor.change_type(current.draft, type),
        dirty: current.draft !== null || current.dirty,
      }
    );
  }

  function save_edit() {
    if (!editing || !can_save(editing.draft)) return;
    const updated = line_editor.update(lines[editing.index], editing.draft);
    emit([
      ...lines.slice(0, editing.index),
      updated,
      ...lines.slice(editing.index + 1),
    ]);
    set_editing(null);
    set_delete_armed_index(null);
  }

  function save_insertion() {
    if (!insertion?.draft || !can_save(insertion.draft)) return;
    emit(
      line_editor.insert(
        lines,
        insertion.index,
        line_editor.create(insertion.draft),
      ),
    );
    set_insertion(null);
  }

  function move_line(index: number, offset: -1 | 1) {
    const next_index = index + offset;
    if (next_index < 0 || next_index >= lines.length) return;
    emit(line_editor.move(lines, index, next_index));
    set_editing((current) =>
      current?.index === index ? { ...current, index: next_index } : current
    );
    set_delete_armed_index(null);
  }

  function delete_line(index: number) {
    if (delete_armed_index !== index) {
      set_delete_armed_index(index);
      return;
    }
    emit(line_editor.remove(lines, index));
    set_editing(null);
    set_delete_armed_index(null);
  }

  return (
    <fieldset
      class="editor-area markdown-area"
      aria-labelledby="markdown-editor-heading"
      disabled={!props.active}
      hidden={!props.active}
    >
      <div class="markdown-editor-heading">
        <span class="field-title" id="markdown-editor-heading">Markdown</span>
        <div
          class="markdown-mode-switcher"
          role="group"
          aria-label="Markdown editing mode"
        >
          <button
            type="button"
            class="compact-button"
            aria-pressed={mode === "raw"}
            onClick={() => change_mode("raw")}
          >
            Raw
          </button>
          <button
            type="button"
            class="compact-button"
            aria-pressed={mode === "steps"}
            onClick={() => change_mode("steps")}
          >
            Steps
          </button>
        </div>
      </div>

      {mode === "raw" && (
        <textarea
          name="md"
          aria-label="Raw Markdown"
          required
          rows={15}
          maxLength={64 * 1024}
          value={props.markdown}
          onInput={(event) =>
            props.on_markdown_input(event.currentTarget.value)}
        />
      )}

      {mode === "steps" && line_limit_exceeded && (
        <div class="markdown-limit-message" role="status">
          <strong>This draft has {lines.length} lines.</strong>
          <span>
            Steps is limited to {structured_line_limit}{" "}
            lines to keep editing responsive. Switch to Raw to continue.
          </span>
        </div>
      )}

      {mode === "steps" && !line_limit_exceeded && (
        <div class="markdown-step-editor">
          <ol class="markdown-lines" aria-label="Markdown lines">
            {lines.map((line, index) => {
              const is_editing = editing?.index === index;
              return (
                <Fragment key={`${index}:${line.raw}`}>
                  {insertion?.index === index && (
                    <MarkdownInsertion
                      insertion={insertion}
                      on_choose={choose_insertion_type}
                      on_change={(draft) =>
                        set_insertion({ ...insertion, draft, dirty: true })}
                      on_save={save_insertion}
                      on_cancel={() => set_insertion(null)}
                    />
                  )}
                  <li class="markdown-line">
                    <button
                      type="button"
                      class={`markdown-line-summary markdown-line-preview-${line.type}`}
                      aria-label={`Edit line ${index + 1}`}
                      aria-expanded={is_editing}
                      onClick={() => toggle_edit(index)}
                    >
                      <MarkdownLinePreview line={line} />
                    </button>

                    {is_editing && editing && (
                      <div class="markdown-line-details">
                        <div class="markdown-line-form">
                          <MarkdownTypeField
                            draft={editing.draft}
                            id_prefix={`edit-${index}`}
                            on_change={(draft) =>
                              set_editing({ ...editing, draft, dirty: true })}
                          />
                          <MarkdownDraftFields
                            draft={editing.draft}
                            id_prefix={`edit-${index}`}
                            on_change={(draft) =>
                              set_editing({ ...editing, draft, dirty: true })}
                          />
                          <div class="markdown-save-actions">
                            <button
                              type="button"
                              disabled={!can_save(editing.draft)}
                              onClick={save_edit}
                            >
                              Save line
                            </button>
                            <button
                              type="button"
                              class="compact-button"
                              onClick={() => set_editing(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>

                        <div class="markdown-line-actions">
                          <button
                            type="button"
                            class="compact-button"
                            disabled={index === 0}
                            onClick={() => move_line(index, -1)}
                          >
                            ↑ Up
                          </button>
                          <button
                            type="button"
                            class="compact-button"
                            disabled={index === lines.length - 1}
                            onClick={() => move_line(index, 1)}
                          >
                            ↓ Down
                          </button>
                          <button
                            type="button"
                            class="compact-button"
                            onClick={() => begin_insert(index)}
                          >
                            + Above
                          </button>
                          <button
                            type="button"
                            class="compact-button"
                            onClick={() => begin_insert(index + 1)}
                          >
                            + Below
                          </button>
                          <button
                            type="button"
                            class="compact-button danger-button"
                            onClick={() => delete_line(index)}
                          >
                            {delete_armed_index === index
                              ? "Confirm delete"
                              : "Delete"}
                          </button>
                        </div>
                        {delete_armed_index === index && (
                          <small role="status">
                            Tap again to delete line {index + 1}.
                          </small>
                        )}
                      </div>
                    )}
                  </li>
                </Fragment>
              );
            })}
            {insertion?.index === lines.length && (
              <MarkdownInsertion
                insertion={insertion}
                on_choose={choose_insertion_type}
                on_change={(draft) =>
                  set_insertion({ ...insertion, draft, dirty: true })}
                on_save={save_insertion}
                on_cancel={() => set_insertion(null)}
              />
            )}
          </ol>
          <button
            type="button"
            class="markdown-add-line-button"
            aria-label="Add line at end"
            disabled={insertion !== null}
            onClick={() => begin_insert(lines.length)}
          >
            +
          </button>
        </div>
      )}

      <small>
        {mode === "raw"
          ? "Up to 64 KiB. Switch to Steps for guided line editing."
          : "Tap a preview to show or hide its controls. The plus button adds a line at the end."}
      </small>
    </fieldset>
  );
}
