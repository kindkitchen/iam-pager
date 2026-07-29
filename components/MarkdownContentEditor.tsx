import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { PagePreviewer } from "../lib/ui/page-preview.ts";
import {
  DeterministicMarkdownSectionDensity,
  type MarkdownSectionDensity,
} from "../lib/ui/markdown-section-density.ts";
import {
  DeterministicMarkdownSectionEditor,
  markdown_heading_levels,
  type MarkdownHeadingLevel,
  type MarkdownSection,
  type MarkdownSectionDraft,
  type MarkdownSectionType,
} from "../lib/ui/markdown-section-editor.ts";
import {
  map_route_step_editor,
  map_step_of_section,
  type MapRouteStep,
} from "../lib/ui/map-route-steps.ts";
import {
  type MapLinkResolver,
  RemoteMapLinkResolver,
} from "../lib/ui/map-link-resolver.ts";
import {
  default_step_editor_config,
  is_step_input_enabled,
  map_route_enabled,
  type StepEditorConfig,
} from "../lib/ui/step-editor-config.ts";
import { step_editor_config_store } from "../lib/ui/step-editor-config-store.ts";
import {
  type ExclusiveContentOption,
  ExclusiveContentSwitcher,
} from "./ExclusiveContentSwitcher.tsx";
import { GoogleMapsPin } from "./GoogleMapsPin.tsx";
import { MapRouteFields } from "./MapRouteFields.tsx";
import { MarkdownStepExtensions } from "./MarkdownStepExtensions.tsx";

export interface MarkdownContentEditorProps {
  panel_id: string;
  label_id: string;
  markdown: string;
  css: string;
  active: boolean;
  on_markdown_input: (value: string) => void;
  previewer: PagePreviewer;
  /** Editing mode the surface opens in; Raw when nothing is stored. */
  initial_mode?: MarkdownEditorMode;
  /** JSON-serializable starting state of the step inputs. */
  initial_step_config?: StepEditorConfig;
  /** Expansion of official Google short links; replaceable by any source. */
  link_resolver?: MapLinkResolver;
  /** Notified whenever the visitor changes the step inputs. */
  on_step_config_change?: (config: StepEditorConfig) => void;
}

export type MarkdownEditorMode = "raw" | "steps";
type InsertableSectionType = Exclude<MarkdownSectionType, "raw">;

const mode_options: readonly ExclusiveContentOption<MarkdownEditorMode>[] = [
  {
    value: "raw",
    label: "Raw",
    button_id: "markdown-mode-raw-button",
    panel_id: "markdown-mode-panel",
  },
  {
    value: "steps",
    label: "Steps",
    button_id: "markdown-mode-steps-button",
    panel_id: "markdown-mode-panel",
  },
];

interface EditingState {
  index: number;
  draft: MarkdownSectionDraft;
  dirty: boolean;
  /** A link edited as a Google Maps stop frame instead of a bare URL. */
  map_mode: boolean;
  /**
   * The frame itself, kept as state instead of re-read from the URL on every
   * render: a URL cannot express every frame (a cleared "your location" is an
   * absent origin, which reads back as present), so deriving it would undo
   * edits the reader just made.
   */
  map_step: MapRouteStep | null;
}

interface InsertionState {
  draft: MarkdownSectionDraft | null;
  dirty: boolean;
  map_step: MapRouteStep | null;
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
const density_controller = new DeterministicMarkdownSectionDensity();
const map_editor = map_route_step_editor;
const config_store = step_editor_config_store();
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

/** Inputs kept switched on in the step-input heading line. */
function offered<T extends { type: MarkdownSectionType }>(
  options: readonly T[],
  config: StepEditorConfig,
): readonly T[] {
  return options.filter((option) => is_step_input_enabled(config, option.type));
}

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
  density: MarkdownSectionDensity;
  previewer: PagePreviewer;
}

function estimated_preview_height(section: MarkdownSection): number {
  const visual_lines = section.raw.split("\n").reduce(
    (count, line) => count + Math.max(1, Math.ceil(line.length / 52)),
    0,
  );
  return Math.max(80, 56 + visual_lines * 24);
}

function MarkdownSectionPreview(props: MarkdownSectionPreviewProps) {
  const frame_ref = useRef<HTMLIFrameElement>(null);
  const [whole_height, set_whole_height] = useState(
    estimated_preview_height(props.section),
  );
  const preview_document = useMemo(
    () =>
      props.previewer.render({
        md: props.section.raw,
        ...(props.css === "" ? {} : { css: props.css }),
      }),
    [props.section.raw, props.css, props.previewer],
  );

  useEffect(() => {
    const frame = frame_ref.current;
    if (!frame || props.density === "compact") return;
    const preview_frame = frame;

    function measure() {
      try {
        const document = preview_frame.contentDocument;
        const root = document?.documentElement;
        const body = document?.body;
        if (!root || !body) return;
        preview_frame.style.height = "1px";
        const measured_height = Math.max(
          80,
          Math.ceil(root.scrollHeight),
          Math.ceil(body.scrollHeight),
        );
        preview_frame.style.height = `${measured_height}px`;
        set_whole_height(measured_height);
      } catch {
        // A draft that navigates its frame cross-origin keeps its safe estimate.
      }
    }

    let measured_width = preview_frame.clientWidth;
    const width_observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width === 0 || width === measured_width) return;
      measured_width = width;
      measure();
    });

    preview_frame.addEventListener("load", measure);
    width_observer.observe(preview_frame);
    measure();
    return () => {
      preview_frame.removeEventListener("load", measure);
      width_observer.disconnect();
    };
  }, [preview_document, props.density]);

  return (
    <iframe
      ref={frame_ref}
      title={`Section ${props.section_number} styled preview`}
      sandbox="allow-same-origin"
      loading="lazy"
      srcdoc={preview_document}
      tabIndex={-1}
      scrolling="no"
      data-density={props.density}
      style={props.density === "whole"
        ? { height: `${whole_height}px` }
        : undefined}
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
      <div class="contextual-input markdown-contextual-input">
        <div class="contextual-input-heading">
          <label for={props.id}>{props.label}</label>
          <div
            class="markdown-value-actions"
            role="group"
            aria-label={`${props.label} actions`}
          >
            <button
              type="button"
              class="embedded-input-action"
              onClick={paste}
            >
              Paste
            </button>
            <button
              type="button"
              class="embedded-input-action"
              onClick={copy}
            >
              Copy
            </button>
            <button
              type="button"
              class="embedded-input-action"
              onClick={() => change("")}
            >
              Clear
            </button>
          </div>
        </div>
        <input
          id={props.id}
          type="text"
          inputMode={props.input_mode}
          value={props.value}
          placeholder={props.placeholder}
          onInput={(event) => change(event.currentTarget.value)}
        />
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
      <div class="contextual-input markdown-contextual-input">
        <div class="contextual-input-heading">
          <label for={props.id}>{props.label}</label>
          <div
            class="markdown-value-actions"
            role="group"
            aria-label={`${props.label} actions`}
          >
            <button
              type="button"
              class="embedded-input-action"
              onClick={paste}
            >
              Paste
            </button>
            <button
              type="button"
              class="embedded-input-action"
              onClick={copy}
            >
              Copy
            </button>
            <button
              type="button"
              class="embedded-input-action"
              onClick={() => change("")}
            >
              Clear
            </button>
          </div>
        </div>
        <textarea
          ref={input_ref}
          id={props.id}
          rows={10}
          value={props.value}
          spellcheck={false}
          onInput={(event) => change(event.currentTarget.value)}
        />
      </div>
      {clipboard_message && <small role="status">{clipboard_message}</small>}
    </div>
  );
}

function can_save(draft: MarkdownSectionDraft): boolean {
  if (draft.type === "link") return draft.url.trim() !== "";
  return draft.type !== "code-block" || !draft.language.includes("`");
}

/** Map controls handed to a Link draft when the map variant is offered. */
interface MapLinkControls {
  readonly available: boolean;
  /** A saved section can switch between simple and map editing. */
  readonly toggleable: boolean;
  readonly active: boolean;
  readonly step: MapRouteStep | null;
  /** Shared expansion of official short links. */
  readonly resolver: MapLinkResolver;
  /** True while the pasted URL is an alias still being expanded. */
  readonly expanding: boolean;
  readonly on_toggle?: (next: boolean) => void;
  readonly on_step_change: (step: MapRouteStep) => void;
  readonly on_split_stop?: (index: number) => void;
  readonly on_message?: (message: string) => void;
}

interface MarkdownDraftFieldsProps {
  draft: MarkdownSectionDraft;
  id_prefix: string;
  on_change: (draft: MarkdownSectionDraft) => void;
  map?: MapLinkControls;
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
    case "link": {
      const map = props.map;
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
          {map?.available && map.toggleable && (
            <label
              class="markdown-link-map-toggle"
              for={`${props.id_prefix}-map-mode`}
            >
              <input
                id={`${props.id_prefix}-map-mode`}
                type="checkbox"
                checked={map.active}
                onChange={(event) =>
                  map.on_toggle?.(event.currentTarget.checked)}
              />
              <span>Google Maps route</span>
            </label>
          )}
          {map?.available && map.expanding && (
            <small class="markdown-link-map-pending" role="status">
              Expanding the Google Maps short link…
            </small>
          )}
          {map?.available && map.active && map.step && (
            <MapRouteFields
              step={map.step}
              id_prefix={props.id_prefix}
              resolver={map.resolver}
              on_change={map.on_step_change}
              {...(map.on_split_stop
                ? { on_split_stop: map.on_split_stop }
                : {})}
              {...(map.on_message ? { on_message: map.on_message } : {})}
            />
          )}
        </div>
      );
    }
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
  config: StepEditorConfig;
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
        {offered(editable_type_options, props.config).map((option) => (
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
  config: StepEditorConfig;
  map?: MapLinkControls;
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
        {offered(insertion_options, props.config).map((option) => (
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
            {...(props.map ? { map: props.map } : {})}
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
  const [mode, set_mode] = useState<MarkdownEditorMode>(
    props.initial_mode ?? "raw",
  );
  const [editing, set_editing] = useState<EditingState | null>(null);
  const [insertion, set_insertion] = useState<InsertionState | null>(null);
  const [delete_armed_index, set_delete_armed_index] = useState<number | null>(
    null,
  );
  const [dragging, set_dragging] = useState<DraggingState | null>(null);
  const [drag_message, set_drag_message] = useState("");
  const [config, set_config] = useState<StepEditorConfig>(
    props.initial_step_config ?? default_step_editor_config(),
  );
  // Bumped whenever a background expansion lands, so section rows that only
  // became map steps just now are re-rendered.
  const [resolutions, set_resolutions] = useState(0);
  const link_resolver = useMemo<MapLinkResolver>(
    () =>
      props.link_resolver ??
        new RemoteMapLinkResolver({
          on_settled: () => set_resolutions((count) => count + 1),
        }),
    [props.link_resolver],
  );
  const dragging_ref = useRef<DraggingState | null>(null);
  const drag_element_ref = useRef<HTMLButtonElement | null>(null);
  const sections = useMemo(
    () => section_editor.parse(props.markdown),
    [props.markdown],
  );
  const [section_densities, set_section_densities] = useState(() =>
    density_controller.reconcile([], sections.length)
  );
  const physical_line_count = props.markdown.split("\n").length;
  const section_limit_exceeded =
    physical_line_count > structured_physical_line_limit;

  useEffect(() => {
    set_section_densities((current) => {
      const reconciled = density_controller.reconcile(
        current,
        sections.length,
      );
      return reconciled.every((density, index) => density === current[index])
        ? current
        : reconciled;
    });
  }, [sections.length]);

  // The stored step-input choice is read after hydration, so the server and
  // the first client render agree.
  useEffect(() => {
    if (props.initial_step_config) return;
    set_config(config_store.load());
  }, []);

  // Short links stored in the document are expanded in the background, so a
  // pasted alias still shows its pin and can be framed with another step.
  // `resolutions` re-runs this after each answer lands.
  useEffect(() => {
    if (mode !== "steps" || !map_route_enabled(config)) return;
    for (const section of sections) {
      const url = link_url_of(section);
      if (url !== null && link_resolver.state(url) === "unresolved") {
        link_resolver.resolve(url);
      }
    }
  }, [sections, mode, config, resolutions]);

  function change_config(next: StepEditorConfig) {
    set_config(next);
    config_store.save(next);
    props.on_step_config_change?.(next);
  }

  /** Canonical URL of a stored link: an alias only once it was expanded. */
  function canonical(url: string): string | null {
    return link_resolver.resolved(url);
  }

  /** A link draft read as map stops, when the map variant is offered. */
  function map_step_of(draft: MarkdownSectionDraft): MapRouteStep | null {
    if (draft.type !== "link" || !map_route_enabled(config)) return null;
    const url = canonical(draft.url);
    if (url === null) return null;
    const step = map_editor.read_link(draft.label, url);
    // A frame that carries no label of its own derives one from its stops.
    return step && draft.label.trim() === "" ? { ...step, label: null } : step;
  }

  /** The frame of a stored section, aliases included once expanded. */
  function section_step(section: MarkdownSection): MapRouteStep | null {
    return map_route_enabled(config)
      ? map_step_of_section(section, canonical)
      : null;
  }

  function link_url_of(section: MarkdownSection): string | null {
    return section.type === "link" ? section.url : null;
  }

  function is_expanding(url: string | null | undefined): boolean {
    if (!url || !map_route_enabled(config)) return false;
    const state = link_resolver.state(url);
    return state === "unresolved" || state === "pending";
  }

  /**
   * The frame after a draft edit. It is only re-read from the URL when the URL
   * itself changed; otherwise the existing frame is kept and merely relabelled,
   * so stop order and the "your location" choice survive every other edit.
   */
  function synced_step(
    previous_draft: MarkdownSectionDraft | null,
    previous_step: MapRouteStep | null,
    draft: MarkdownSectionDraft,
  ): MapRouteStep | null {
    if (draft.type !== "link" || !map_route_enabled(config)) return null;
    const url_changed = previous_draft?.type !== "link" ||
      previous_draft.url !== draft.url;
    if (url_changed || previous_step === null) return map_step_of(draft);
    return map_editor.set_label(previous_step, draft.label);
  }

  /** Label and URL a frame serializes to. */
  function framed_draft(
    draft: MarkdownSectionDraft,
    step: MapRouteStep,
  ): MarkdownSectionDraft {
    if (draft.type !== "link") return draft;
    return {
      ...draft,
      label: map_editor.label(step),
      url: map_editor.can_generate(step) ? map_editor.url(step) : draft.url,
    };
  }

  /**
   * Asks the site to dereference an official short link. The alias carries no
   * place of its own, so nothing can be shown until this returns.
   */
  function request_expansion(url: string): void {
    if (!map_route_enabled(config)) return;
    if (link_resolver.state(url) !== "unresolved") return;
    link_resolver.resolve(url).then((expanded) => {
      if (expanded === null) {
        set_drag_message("That Google Maps short link could not be expanded.");
        return;
      }
      adopt_expansion(url, expanded);
    });
  }

  /** Replaces an open alias draft with the place or route it stands for. */
  function adopt_expansion(alias: string, expanded: string): void {
    const framed = (draft: MarkdownSectionDraft) => {
      if (draft.type !== "link" || draft.url !== alias) return null;
      const step = map_editor.read_link(draft.label, expanded);
      if (!step) return null;
      const named = draft.label.trim() === "" ? { ...step, label: null } : step;
      return { draft: framed_draft(draft, named), step: named };
    };

    set_editing((current) => {
      const next = current && framed(current.draft);
      return next && current
        ? {
          ...current,
          draft: next.draft,
          dirty: true,
          map_mode: true,
          map_step: next.step,
        }
        : current;
    });
    set_insertion((current) => {
      const next = current?.draft && framed(current.draft);
      return next && current
        ? { draft: next.draft, dirty: true, map_step: next.step }
        : current;
    });
    set_drag_message("Expanded the Google Maps short link into its stops.");
  }

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

  function change_mode(next_mode: MarkdownEditorMode): boolean {
    if (next_mode === mode) return true;
    if (!allow_discard()) return false;
    set_editing(null);
    set_insertion(null);
    set_delete_armed_index(null);
    set_mode(next_mode);
    return true;
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
    const draft = section_editor.draft(sections[index]);
    const step = map_step_of(draft);
    set_editing({
      index,
      draft,
      dirty: false,
      // A link that already addresses Maps opens as a stop frame.
      map_mode: step !== null,
      map_step: step,
    });
    if (draft.type === "link") request_expansion(draft.url);
  }

  /** Every draft edit goes through here, so the frame follows the URL. */
  function change_editing_draft(draft: MarkdownSectionDraft) {
    if (!editing) return;
    const step = synced_step(editing.draft, editing.map_step, draft);
    const became_map = step !== null && editing.map_step === null;
    set_editing({
      ...editing,
      draft,
      dirty: true,
      // A URL that just became a Maps link opens its frame by itself.
      map_mode: (editing.map_mode || became_map) && draft.type === "link" &&
        step !== null,
      map_step: step,
    });
    if (draft.type === "link") request_expansion(draft.url);
  }

  function change_insertion_draft(draft: MarkdownSectionDraft) {
    set_insertion((current) => {
      if (current === null) return current;
      return {
        draft,
        dirty: true,
        map_step: synced_step(current.draft, current.map_step, draft),
      };
    });
    if (draft.type === "link") request_expansion(draft.url);
  }

  /**
   * Simple is always available; the map frame only after the URL validates as
   * a Google Maps place or route, otherwise the request is refused untouched.
   */
  function toggle_map_mode(next: boolean) {
    if (!editing) return;
    if (!next) {
      set_editing({ ...editing, map_mode: false });
      set_drag_message("This link is edited as a simple label and URL.");
      return;
    }
    const step = editing.map_step ?? map_step_of(editing.draft);
    if (step === null) {
      const url = editing.draft.type === "link" ? editing.draft.url : "";
      set_drag_message(
        is_expanding(url)
          ? "This short link is still being expanded; the stops open on their own."
          : "This URL is not a Google Maps place or route link, so it stays a simple link.",
      );
      return;
    }
    set_editing({ ...editing, map_mode: true, map_step: step });
    set_drag_message("This link is edited as Google Maps stops.");
  }

  /** Writes a changed frame back into the draft as label and URL. */
  function change_map_step(step: MapRouteStep) {
    if (!editing || editing.draft.type !== "link") return;
    set_editing({
      ...editing,
      draft: framed_draft(editing.draft, step),
      dirty: true,
      map_step: step,
    });
  }

  /** Moves one stop out of the frame into its own section below this one. */
  function split_map_stop(stop_index: number) {
    if (!editing || editing.draft.type !== "link") return;
    const step = editing.map_step;
    if (!step || step.stops.length < 2) return;
    const { remaining, extracted } = map_editor.extract_stop(step, stop_index);
    if (!remaining || !map_editor.can_generate(remaining)) {
      set_drag_message("A route keeps at least one place; this stop stays.");
      return;
    }
    const target_index = editing.index;
    const updated = section_editor.update(sections[target_index], {
      ...editing.draft,
      label: map_editor.label(remaining),
      url: map_editor.url(remaining),
    });
    const created = map_editor.section(extracted);
    emit([
      ...sections.slice(0, target_index),
      updated,
      created,
      ...sections.slice(target_index + 1),
    ]);
    set_section_densities((current) =>
      density_controller.reconcile(current, sections.length + 1)
    );
    set_editing(null);
    set_drag_message(
      `Stop ${stop_index + 1} became section ${target_index + 2}.`,
    );
  }

  function begin_insert() {
    if (!allow_discard()) return;
    set_editing(null);
    set_delete_armed_index(null);
    set_insertion({ draft: null, dirty: false, map_step: null });
  }

  function change_insertion_map_step(step: MapRouteStep) {
    set_insertion((current) => {
      if (!current?.draft || current.draft.type !== "link") return current;
      return {
        draft: framed_draft(current.draft, step),
        dirty: true,
        map_step: step,
      };
    });
  }

  function choose_insertion_type(type: InsertableSectionType) {
    set_insertion((current) => {
      if (current === null) return null;
      const draft = current.draft === null
        ? new_draft(type)
        : section_editor.change_type(current.draft, type);
      return {
        draft,
        dirty: current.draft !== null || current.dirty,
        map_step: synced_step(current.draft, current.map_step, draft),
      };
    });
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
    set_section_densities((current) =>
      density_controller.remove(current, index)
    );
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
    set_section_densities((current) =>
      density_controller.move(current, from_index, to_index)
    );
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

    // An alias says nothing until it is expanded; merging it as text would
    // destroy a route the reader is about to get.
    const aliases = [from_index, into_index]
      .map((index) => link_url_of(sections[index]))
      .filter((url): url is string => is_expanding(url));
    if (aliases.length > 0) {
      for (const url of aliases) request_expansion(url);
      set_drag_message(
        "Expanding a Google Maps short link — drop again in a moment.",
      );
      return;
    }

    // Two map links keep every point instead of concatenating their text:
    // dropping one on the other frames them into a single ordered route.
    const source_step = section_step(sections[from_index]);
    const target_step = source_step && section_step(sections[into_index]);

    if (source_step && target_step) {
      const merged = map_editor.merge(target_step, source_step);
      const next_sections = [...sections];
      next_sections[into_index] = map_editor.section(
        merged,
        sections[into_index],
      );
      next_sections.splice(from_index, 1);
      emit(next_sections);
      set_drag_message(
        `Framed section ${from_index + 1} into section ${
          into_index + 1
        } as route stops.`,
      );
    } else {
      emit(section_editor.merge(sections, from_index, into_index));
      set_drag_message(
        `Merged section ${from_index + 1} into section ${into_index + 1}.`,
      );
    }
    set_section_densities((current) =>
      density_controller.remove(current, from_index)
    );
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
      id={props.panel_id}
      class="editor-area markdown-area exclusive-content-panel"
      role="tabpanel"
      aria-labelledby={props.label_id}
      disabled={!props.active}
      hidden={!props.active}
    >
      <div class="markdown-mode-stack exclusive-content-stack">
        <ExclusiveContentSwitcher
          aria_label="Markdown editing mode"
          value={mode}
          options={mode_options}
          class_name="markdown-mode-switcher"
          on_select={change_mode}
        />
        <div
          id="markdown-mode-panel"
          class="markdown-mode-panel"
          role="tabpanel"
          aria-labelledby={mode === "raw"
            ? "markdown-mode-raw-button"
            : "markdown-mode-steps-button"}
        >
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
              <strong>
                This draft has {physical_line_count} physical lines.
              </strong>
              <span>
                Steps is limited to {structured_physical_line_limit}{" "}
                physical lines to keep section editing responsive. Switch to Raw
                to continue.
              </span>
            </div>
          )}

          {mode === "steps" && !section_limit_exceeded && (
            <div class="markdown-step-editor">
              <MarkdownStepExtensions
                config={config}
                on_change={change_config}
              />
              <ol class="markdown-sections" aria-label="Markdown sections">
                {sections.map((section, index) => {
                  const is_editing = editing?.index === index;
                  const density = section_densities[index] ?? "whole";
                  const map_step = section_step(section);
                  const expanding = is_expanding(link_url_of(section));
                  return (
                    <li
                      key={`${index}:${section.raw}`}
                      class="markdown-section"
                      data-markdown-section-index={index}
                      data-map-step={map_step !== null}
                      data-map-pending={expanding}
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
                        {(map_step !== null || expanding) && (
                          <GoogleMapsPin
                            title={expanding
                              ? `Expanding the Google Maps short link of section ${
                                index + 1
                              }`
                              : `Section ${index + 1} is a Google Maps route`}
                          />
                        )}
                        <MarkdownSectionPreview
                          section={section}
                          section_number={index + 1}
                          css={props.css}
                          density={density}
                          previewer={props.previewer}
                        />
                        <button
                          type="button"
                          class="markdown-density-toggle context-button"
                          aria-label={density === "compact"
                            ? `Show whole section ${index + 1}`
                            : `Compact section ${index + 1}`}
                          aria-pressed={density === "compact"}
                          onClick={() =>
                            set_section_densities((current) =>
                              density_controller.toggle(current, index)
                            )}
                        >
                          {density === "compact" ? "Whole" : "Compact"}
                        </button>
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
                                config={config}
                                on_change={change_editing_draft}
                              />
                              <MarkdownListField
                                draft={editing.draft}
                                id_prefix={`edit-${index}`}
                                on_change={change_editing_draft}
                              />
                            </div>
                            <MarkdownDraftFields
                              draft={editing.draft}
                              id_prefix={`edit-${index}`}
                              on_change={change_editing_draft}
                              map={{
                                available: map_route_enabled(config),
                                toggleable: true,
                                active: editing.map_mode,
                                step: editing.map_mode
                                  ? editing.map_step
                                  : null,
                                resolver: link_resolver,
                                expanding: is_expanding(
                                  editing.draft.type === "link"
                                    ? editing.draft.url
                                    : null,
                                ),
                                on_toggle: toggle_map_mode,
                                on_step_change: change_map_step,
                                on_split_stop: split_map_stop,
                                on_message: set_drag_message,
                              }}
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
                    config={config}
                    map={{
                      available: map_route_enabled(config),
                      toggleable: false,
                      // A pasted Maps URL turns the new link into a frame on
                      // its own; nothing else changes.
                      active: true,
                      step: insertion.map_step,
                      resolver: link_resolver,
                      expanding: is_expanding(
                        insertion.draft?.type === "link"
                          ? insertion.draft.url
                          : null,
                      ),
                      on_step_change: change_insertion_map_step,
                      on_message: set_drag_message,
                    }}
                    on_choose={choose_insertion_type}
                    on_change={change_insertion_draft}
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
        </div>
      </div>

      <small>
        {mode === "raw"
          ? "Up to 64 KiB. Switch to Steps for guided section editing."
          : "Tap a preview to edit it. Whole previews follow their rendered content; Compact keeps an individual card short. Drag the grip between sections to reorder, or over a section to append its value there — two Google Maps links frame into one ordered route instead. A pasted maps.app.goo.gl link is expanded by the site and marked with a pin. Focused grips also use arrow keys. The plus button adds at the end. The heading line switches step inputs on or off."}
      </small>
      <span class="visually-hidden" role="status" aria-live="polite">
        {drag_message}
      </span>
    </fieldset>
  );
}
