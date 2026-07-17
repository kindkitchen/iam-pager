import type { JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import type { PagePreviewer } from "../lib/ui/page-preview.ts";
import {
  DeterministicMarkdownSectionEditor,
  markdown_heading_levels,
  type MarkdownHeadingLevel,
  type MarkdownSection,
  type MarkdownSectionDraft,
  type MarkdownSectionType,
} from "../lib/ui/markdown-section-editor.ts";

export interface MarkdownContentEditorProps {
  markdown: string;
  css: string;
  active: boolean;
  on_markdown_input: (value: string) => void;
  previewer: PagePreviewer;
}

type MarkdownEditorMode = "raw" | "steps";
type InsertableSectionType = Exclude<MarkdownSectionType, "raw">;

interface EditingState {
  index: number;
  draft: MarkdownSectionDraft;
  dirty: boolean;
}

interface InsertionState {
  draft: MarkdownSectionDraft | null;
  dirty: boolean;
}

type SectionDropTarget =
  | { type: "move"; target_index: number }
  | { type: "merge"; target_index: number };

interface DraggingState {
  from_index: number;
  drop_target: SectionDropTarget;
  pointer_id: number;
}

const section_editor = new DeterministicMarkdownSectionEditor();
const structured_physical_line_limit = 500;

const section_type_labels: Readonly<Record<MarkdownSectionType, string>> = {
  text: "Text",
  heading: "Heading",
  link: "Link",
  "code-block": "Code block",
  raw: "Markdown",
};

const insertion_options: readonly {
  type: InsertableSectionType;
  label: string;
}[] = [
  { type: "text", label: "Text" },
  { type: "heading", label: "Heading" },
  { type: "link", label: "Link" },
  { type: "code-block", label: "Code block" },
];

const editable_type_options: readonly {
  type: MarkdownSectionType;
  label: string;
}[] = [
  ...insertion_options,
  { type: "raw", label: "Raw Markdown" },
];

function new_draft(type: InsertableSectionType): MarkdownSectionDraft {
  switch (type) {
    case "heading":
      return { type, level: 2, value: "", list_type: null };
    case "link":
      return { type, label: "", url: "", list_type: null };
    case "code-block":
      return { type, language: "", value: "", list_type: null };
    case "text":
      return { type, value: "", list_type: null };
  }
}

interface MarkdownSectionPreviewProps {
  section: MarkdownSection;
  section_number: number;
  css: string;
  previewer: PagePreviewer;
}

function MarkdownSectionPreview(props: MarkdownSectionPreviewProps) {
  const preview_document = useMemo(
    () =>
      props.previewer.render({
        md: props.section.raw,
        ...(props.css === "" ? {} : { css: props.css }),
      }),
    [props.section.raw, props.css, props.previewer],
  );
  const line_count = props.section.raw.split("\n").length;
  const preview_height = Math.min(18, 5 + (line_count - 1) * 1.5);

  return (
    <iframe
      title={`Section ${props.section_number} styled preview`}
      sandbox=""
      loading="lazy"
      srcdoc={preview_document}
      tabIndex={-1}
      style={{ height: `${preview_height}rem` }}
    />
  );
}

function DragGripIcon() {
  return (
    <svg viewBox="0 0 16 24" aria-hidden="true" focusable="false">
      {[4, 12].map((x) =>
        [4, 12, 20].map((y) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" />
        ))
      )}
    </svg>
  );
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

interface MarkdownMultilineValueFieldProps {
  id: string;
  label: string;
  value: string;
  on_change: (value: string) => void;
}

function MarkdownMultilineValueField(
  props: MarkdownMultilineValueFieldProps,
) {
  const [clipboard_message, set_clipboard_message] = useState("");
  const input_ref = useRef<HTMLTextAreaElement>(null);

  function change(value: string) {
    set_clipboard_message("");
    props.on_change(value);
  }

  async function paste() {
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard) throw new Error("Clipboard access is unavailable.");
      change(await clipboard.readText());
      set_clipboard_message("Pasted.");
    } catch {
      input_ref.current?.focus();
      set_clipboard_message(
        "Clipboard access was blocked. Paste directly into the Code field.",
      );
    }
  }

  async function copy() {
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard) throw new Error("Clipboard access is unavailable.");
      await clipboard.writeText(props.value);
      set_clipboard_message("Copied.");
    } catch {
      input_ref.current?.focus();
      input_ref.current?.select();
      set_clipboard_message(
        "Clipboard access was not allowed. Copy the selected code directly.",
      );
    }
  }

  return (
    <div class="markdown-value-field markdown-code-value-field">
      <label for={props.id}>
        {props.label}
        <textarea
          ref={input_ref}
          id={props.id}
          rows={10}
          value={props.value}
          spellcheck={false}
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

function can_save(draft: MarkdownSectionDraft): boolean {
  if (draft.type === "link") return draft.url.trim() !== "";
  return draft.type !== "code-block" || !draft.language.includes("`");
}

interface MarkdownDraftFieldsProps {
  draft: MarkdownSectionDraft;
  id_prefix: string;
  on_change: (draft: MarkdownSectionDraft) => void;
}

function MarkdownDraftFields(props: MarkdownDraftFieldsProps) {
  const { draft } = props;
  switch (draft.type) {
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
    case "code-block":
      return (
        <div class="markdown-code-block-fields">
          <MarkdownValueField
            id={`${props.id_prefix}-language`}
            label="Language (optional)"
            value={draft.language}
            placeholder="ts"
            on_change={(language) => props.on_change({ ...draft, language })}
          />
          {draft.language.includes("`") && (
            <small class="error-message">
              Language cannot contain a backtick.
            </small>
          )}
          <MarkdownMultilineValueField
            id={`${props.id_prefix}-value`}
            label="Code"
            value={draft.value}
            on_change={(value) => props.on_change({ ...draft, value })}
          />
        </div>
      );
    case "text":
    case "raw":
      return (
        <MarkdownValueField
          id={`${props.id_prefix}-value`}
          label={section_type_labels[draft.type]}
          value={draft.value}
          on_change={(value) => props.on_change({ ...draft, value })}
        />
      );
  }
}

interface MarkdownTypeFieldProps {
  draft: MarkdownSectionDraft;
  id_prefix: string;
  on_change: (draft: MarkdownSectionDraft) => void;
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
            section_editor.change_type(
              props.draft,
              event.currentTarget.value as MarkdownSectionType,
            ),
          )}
      >
        {editable_type_options.map((option) => (
          <option
            value={option.type}
            disabled={!section_editor.can_change_type(
              props.draft,
              option.type,
            )}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface MarkdownListFieldProps {
  draft: MarkdownSectionDraft;
  id_prefix: string;
  on_change: (draft: MarkdownSectionDraft) => void;
}

function MarkdownListField(props: MarkdownListFieldProps) {
  if (props.draft.type === "code-block") return null;
  const is_list_item = props.draft.list_type !== null;

  return (
    <div class="markdown-list-field">
      <label
        class="markdown-list-checkbox"
        for={`${props.id_prefix}-is-list-item`}
      >
        <input
          id={`${props.id_prefix}-is-list-item`}
          type="checkbox"
          checked={is_list_item}
          onChange={(event) =>
            props.on_change(
              section_editor.change_list_type(
                props.draft,
                event.currentTarget.checked
                  ? props.draft.list_type ?? "bulleted"
                  : null,
              ),
            )}
        />
        <span>Is list item</span>
      </label>
      {is_list_item && (
        <label
          class="markdown-list-checkbox markdown-list-numbered-checkbox"
          for={`${props.id_prefix}-is-numbered`}
        >
          <input
            id={`${props.id_prefix}-is-numbered`}
            type="checkbox"
            checked={props.draft.list_type === "numbered"}
            onChange={(event) =>
              props.on_change(
                section_editor.change_list_type(
                  props.draft,
                  event.currentTarget.checked ? "numbered" : "bulleted",
                ),
              )}
          />
          <span>Numbered</span>
        </label>
      )}
    </div>
  );
}

interface MarkdownInsertionProps {
  section_number: number;
  insertion: InsertionState;
  on_choose: (type: InsertableSectionType) => void;
  on_change: (draft: MarkdownSectionDraft) => void;
  on_save: () => void;
  on_cancel: () => void;
}

function MarkdownInsertion(props: MarkdownInsertionProps) {
  return (
    <li class="markdown-section-insertion">
      <div class="markdown-insertion-heading">
        <strong>Add section {props.section_number}</strong>
        <button
          type="button"
          class="compact-button"
          onClick={props.on_cancel}
        >
          Cancel
        </button>
      </div>
      <div class="markdown-type-picker" role="group" aria-label="Section type">
        {insertion_options.map((option) => (
          <button
            type="button"
            class="compact-button"
            aria-pressed={props.insertion.draft?.type === option.type}
            disabled={props.insertion.draft !== null &&
              !section_editor.can_change_type(
                props.insertion.draft,
                option.type,
              )}
            onClick={() => props.on_choose(option.type)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {props.insertion.draft && (
        <div class="markdown-section-form">
          <MarkdownListField
            draft={props.insertion.draft}
            id_prefix={`insert-${props.section_number}`}
            on_change={props.on_change}
          />
          <MarkdownDraftFields
            draft={props.insertion.draft}
            id_prefix={`insert-${props.section_number}`}
            on_change={props.on_change}
          />
          <button
            type="button"
            disabled={!can_save(props.insertion.draft)}
            onClick={props.on_save}
          >
            Add section
          </button>
        </div>
      )}
    </li>
  );
}

function remap_index_after_move(
  index: number,
  from_index: number,
  to_index: number,
): number {
  if (index === from_index) return to_index;
  if (from_index < to_index && index > from_index && index <= to_index) {
    return index - 1;
  }
  if (to_index < from_index && index >= to_index && index < from_index) {
    return index + 1;
  }
  return index;
}

export function MarkdownContentEditor(props: MarkdownContentEditorProps) {
  const [mode, set_mode] = useState<MarkdownEditorMode>("raw");
  const [editing, set_editing] = useState<EditingState | null>(null);
  const [insertion, set_insertion] = useState<InsertionState | null>(null);
  const [delete_armed_index, set_delete_armed_index] = useState<number | null>(
    null,
  );
  const [dragging, set_dragging] = useState<DraggingState | null>(null);
  const [drag_message, set_drag_message] = useState("");
  const dragging_ref = useRef<DraggingState | null>(null);
  const drag_element_ref = useRef<HTMLButtonElement | null>(null);
  const sections = useMemo(
    () => section_editor.parse(props.markdown),
    [props.markdown],
  );
  const physical_line_count = props.markdown.split("\n").length;
  const section_limit_exceeded =
    physical_line_count > structured_physical_line_limit;

  function has_unsaved_changes(): boolean {
    return editing?.dirty === true || insertion?.dirty === true;
  }

  function allow_discard(): boolean {
    return !has_unsaved_changes() || globalThis.confirm(
      "Discard the unsaved section changes?",
    );
  }

  function emit(next_sections: readonly MarkdownSection[]) {
    props.on_markdown_input(section_editor.serialize(next_sections));
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
      draft: section_editor.draft(sections[index]),
      dirty: false,
    });
  }

  function begin_insert() {
    if (!allow_discard()) return;
    set_editing(null);
    set_delete_armed_index(null);
    set_insertion({ draft: null, dirty: false });
  }

  function choose_insertion_type(type: InsertableSectionType) {
    set_insertion((current) =>
      current === null ? null : {
        draft: current.draft === null
          ? new_draft(type)
          : section_editor.change_type(current.draft, type),
        dirty: current.draft !== null || current.dirty,
      }
    );
  }

  function save_edit() {
    if (!editing || !can_save(editing.draft)) return;
    const updated = section_editor.update(
      sections[editing.index],
      editing.draft,
    );
    emit([
      ...sections.slice(0, editing.index),
      updated,
      ...sections.slice(editing.index + 1),
    ]);
    set_editing(null);
    set_delete_armed_index(null);
  }

  function save_insertion() {
    if (!insertion?.draft || !can_save(insertion.draft)) return;
    emit(
      section_editor.insert(
        sections,
        sections.length,
        section_editor.create(insertion.draft),
      ),
    );
    set_insertion(null);
    set_drag_message(
      `Added section ${sections.length + 1}. Drag its grip to reposition it.`,
    );
  }

  function delete_section(index: number) {
    if (delete_armed_index !== index) {
      set_delete_armed_index(index);
      return;
    }
    emit(section_editor.remove(sections, index));
    set_editing(null);
    set_delete_armed_index(null);
    set_drag_message(`Deleted section ${index + 1}.`);
  }

  function commit_move(from_index: number, to_index: number) {
    if (from_index === to_index) {
      set_drag_message(`Section ${from_index + 1} stayed in place.`);
      return;
    }
    emit(section_editor.move(sections, from_index, to_index));
    set_editing((current) =>
      current === null ? null : {
        ...current,
        index: remap_index_after_move(current.index, from_index, to_index),
      }
    );
    set_delete_armed_index((current) =>
      current === null
        ? null
        : remap_index_after_move(current, from_index, to_index)
    );
    set_drag_message(
      `Moved section ${from_index + 1} to position ${to_index + 1}.`,
    );
  }

  function commit_merge(from_index: number, into_index: number) {
    if (
      editing?.dirty &&
      (editing.index === from_index || editing.index === into_index)
    ) {
      set_drag_message(
        "Save or cancel the affected section edit before merging.",
      );
      return;
    }

    emit(section_editor.merge(sections, from_index, into_index));
    set_editing((current) => {
      if (
        current === null || current.index === from_index ||
        current.index === into_index
      ) {
        return null;
      }
      return {
        ...current,
        index: current.index > from_index ? current.index - 1 : current.index,
      };
    });
    set_delete_armed_index(null);
    set_drag_message(
      `Merged section ${from_index + 1} into section ${into_index + 1}.`,
    );
  }

  function update_dragging(next: DraggingState | null) {
    dragging_ref.current = next;
    set_dragging(next);
  }

  function begin_drag(
    event: JSX.TargetedPointerEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.button !== 0 || sections.length < 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag_element_ref.current = event.currentTarget;
    update_dragging({
      from_index: index,
      drop_target: { type: "move", target_index: index },
      pointer_id: event.pointerId,
    });
    set_drag_message(`Picked up section ${index + 1}.`);
  }

  function drag_section(event: JSX.TargetedPointerEvent<HTMLButtonElement>) {
    const current = dragging_ref.current;
    if (!current || current.pointer_id !== event.pointerId) return;
    event.preventDefault();

    const section_elements = Array.from(
      globalThis.document.querySelectorAll<HTMLElement>(
        "[data-markdown-section-index]",
      ),
    );
    let drop_target: SectionDropTarget = {
      type: "move",
      target_index: section_elements.length,
    };
    for (const element of section_elements) {
      const bounds = element.getBoundingClientRect();
      const target_index = Number(element.dataset.markdownSectionIndex);
      const edge_size = Math.min(32, bounds.height * 0.25);
      if (event.clientY < bounds.top + edge_size) {
        drop_target = { type: "move", target_index };
        break;
      }
      if (event.clientY <= bounds.bottom - edge_size) {
        drop_target = target_index === current.from_index
          ? { type: "move", target_index: target_index + 1 }
          : { type: "merge", target_index };
        break;
      }
      if (event.clientY <= bounds.bottom) {
        drop_target = { type: "move", target_index: target_index + 1 };
        break;
      }
    }

    if (
      drop_target.type !== current.drop_target.type ||
      drop_target.target_index !== current.drop_target.target_index
    ) {
      update_dragging({ ...current, drop_target });
      set_drag_message(
        drop_target.type === "merge"
          ? `Drop section ${current.from_index + 1} into section ${
            drop_target.target_index + 1
          }.`
          : `Move section ${current.from_index + 1} to the indicated position.`,
      );
    }
    if (event.clientY < 72) {
      globalThis.scrollBy({ top: -24, behavior: "instant" });
    } else if (event.clientY > globalThis.innerHeight - 72) {
      globalThis.scrollBy({ top: 24, behavior: "instant" });
    }
  }

  function finish_drag(event: JSX.TargetedPointerEvent<HTMLButtonElement>) {
    const current = dragging_ref.current;
    if (!current || current.pointer_id !== event.pointerId) return;
    try {
      drag_element_ref.current?.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already be released by the browser.
    }
    drag_element_ref.current = null;
    update_dragging(null);

    if (current.drop_target.type === "merge") {
      commit_merge(current.from_index, current.drop_target.target_index);
      return;
    }
    const to_index = current.drop_target.target_index > current.from_index
      ? current.drop_target.target_index - 1
      : current.drop_target.target_index;
    commit_move(current.from_index, to_index);
  }

  function cancel_drag(event: JSX.TargetedPointerEvent<HTMLButtonElement>) {
    const current = dragging_ref.current;
    if (!current || current.pointer_id !== event.pointerId) return;
    drag_element_ref.current = null;
    update_dragging(null);
    set_drag_message(`Canceled moving section ${current.from_index + 1}.`);
  }

  function keyboard_move(
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let to_index = index;
    if (event.key === "ArrowUp") to_index = Math.max(0, index - 1);
    else if (event.key === "ArrowDown") {
      to_index = Math.min(sections.length - 1, index + 1);
    } else if (event.key === "Home") to_index = 0;
    else if (event.key === "End") to_index = sections.length - 1;
    else return;

    event.preventDefault();
    commit_move(index, to_index);
    globalThis.requestAnimationFrame(() => {
      globalThis.document.querySelector<HTMLButtonElement>(
        `[data-markdown-section-index="${to_index}"] .markdown-drag-handle`,
      )?.focus();
    });
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

      {mode === "steps" && section_limit_exceeded && (
        <div class="markdown-limit-message" role="status">
          <strong>This draft has {physical_line_count} physical lines.</strong>
          <span>
            Steps is limited to {structured_physical_line_limit}{" "}
            physical lines to keep section editing responsive. Switch to Raw to
            continue.
          </span>
        </div>
      )}

      {mode === "steps" && !section_limit_exceeded && (
        <div class="markdown-step-editor">
          <ol class="markdown-sections" aria-label="Markdown sections">
            {sections.map((section, index) => {
              const is_editing = editing?.index === index;
              return (
                <li
                  key={`${index}:${section.raw}`}
                  class="markdown-section"
                  data-markdown-section-index={index}
                  data-drop-before={dragging?.drop_target.type === "move" &&
                    dragging.drop_target.target_index === index}
                  data-drop-into={dragging?.drop_target.type === "merge" &&
                    dragging.drop_target.target_index === index}
                  data-dragging={dragging?.from_index === index}
                >
                  <div
                    class="markdown-section-summary"
                    data-expanded={is_editing}
                  >
                    <button
                      type="button"
                      class="markdown-drag-handle compact-button"
                      aria-label={`Drag section ${index + 1}`}
                      title="Drag between sections to reorder or over a section to merge; use arrow keys when focused"
                      disabled={sections.length < 2}
                      onPointerDown={(event) => begin_drag(event, index)}
                      onPointerMove={drag_section}
                      onPointerUp={finish_drag}
                      onPointerCancel={cancel_drag}
                      onKeyDown={(event) => keyboard_move(event, index)}
                    >
                      <DragGripIcon />
                    </button>
                    <MarkdownSectionPreview
                      section={section}
                      section_number={index + 1}
                      css={props.css}
                      previewer={props.previewer}
                    />
                    <button
                      type="button"
                      class="markdown-section-toggle"
                      aria-label={`Edit section ${index + 1}`}
                      aria-expanded={is_editing}
                      onClick={() => toggle_edit(index)}
                    >
                      <span class="visually-hidden">
                        Edit section {index + 1}
                      </span>
                    </button>
                  </div>

                  {is_editing && editing && (
                    <div class="markdown-section-details">
                      <div class="markdown-section-form">
                        <div class="markdown-section-modifiers">
                          <MarkdownTypeField
                            draft={editing.draft}
                            id_prefix={`edit-${index}`}
                            on_change={(draft) =>
                              set_editing({ ...editing, draft, dirty: true })}
                          />
                          <MarkdownListField
                            draft={editing.draft}
                            id_prefix={`edit-${index}`}
                            on_change={(draft) =>
                              set_editing({ ...editing, draft, dirty: true })}
                          />
                        </div>
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
                            Save section
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

                      <div class="markdown-section-actions">
                        <button
                          type="button"
                          class="compact-button danger-button"
                          onClick={() => delete_section(index)}
                        >
                          {delete_armed_index === index
                            ? "Confirm delete"
                            : "Delete section"}
                        </button>
                      </div>
                      {delete_armed_index === index && (
                        <small role="status">
                          Tap again to delete section {index + 1}.
                        </small>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
            {dragging && (
              <li
                class="markdown-section-drop-end"
                data-active={dragging.drop_target.type === "move" &&
                  dragging.drop_target.target_index === sections.length}
              >
                Drop at end
              </li>
            )}
            {insertion && (
              <MarkdownInsertion
                section_number={sections.length + 1}
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
            class="markdown-add-section-button"
            aria-label="Add section at end"
            disabled={insertion !== null || dragging !== null}
            onClick={begin_insert}
          >
            +
          </button>
        </div>
      )}

      <small>
        {mode === "raw"
          ? "Up to 64 KiB. Switch to Steps for guided section editing."
          : "Tap a preview to edit it. Drag the grip between sections to reorder, or over a section to append its value there. Focused grips also use arrow keys. The plus button adds at the end."}
      </small>
      <span class="visually-hidden" role="status" aria-live="polite">
        {drag_message}
      </span>
    </fieldset>
  );
}
