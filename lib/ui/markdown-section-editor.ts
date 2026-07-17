export const markdown_heading_levels = [1, 2, 3, 4, 5, 6] as const;
export const markdown_list_types = ["bulleted", "numbered"] as const;

export type MarkdownHeadingLevel = typeof markdown_heading_levels[number];
export type MarkdownListType = typeof markdown_list_types[number];
export type MarkdownSectionType =
  | "text"
  | "heading"
  | "link"
  | "code-block"
  | "raw";

export interface MarkdownListMarker {
  readonly type: MarkdownListType;
  readonly prefix: string;
}

interface MarkdownSectionBase {
  /** Exact source for this section, excluding its boundary newline separator. */
  readonly raw: string;
  readonly list: MarkdownListMarker | null;
}

export interface TextMarkdownSection extends MarkdownSectionBase {
  readonly type: "text";
  readonly value: string;
}

export interface HeadingMarkdownSection extends MarkdownSectionBase {
  readonly type: "heading";
  readonly level: MarkdownHeadingLevel;
  readonly value: string;
}

export interface LinkMarkdownSection extends MarkdownSectionBase {
  readonly type: "link";
  readonly label: string;
  readonly url: string;
}

export interface CodeBlockMarkdownSection extends MarkdownSectionBase {
  readonly type: "code-block";
  readonly list: null;
  readonly language: string;
  readonly value: string;
  readonly fence: string;
  readonly closed: boolean;
}

export interface RawMarkdownSection extends MarkdownSectionBase {
  readonly type: "raw";
  readonly value: string;
}

export type MarkdownSection =
  | TextMarkdownSection
  | HeadingMarkdownSection
  | LinkMarkdownSection
  | CodeBlockMarkdownSection
  | RawMarkdownSection;

interface MarkdownSectionDraftBase {
  readonly list_type: MarkdownListType | null;
}

export type MarkdownSectionDraft =
  | (MarkdownSectionDraftBase & {
    readonly type: "text";
    readonly value: string;
  })
  | (MarkdownSectionDraftBase & {
    readonly type: "heading";
    readonly level: MarkdownHeadingLevel;
    readonly value: string;
  })
  | (MarkdownSectionDraftBase & {
    readonly type: "link";
    readonly label: string;
    readonly url: string;
  })
  | (MarkdownSectionDraftBase & {
    readonly type: "code-block";
    readonly language: string;
    readonly value: string;
    readonly list_type: null;
  })
  | (MarkdownSectionDraftBase & {
    readonly type: "raw";
    readonly value: string;
  });

/**
 * Lossless boundary between raw Markdown and the optional section editor.
 * Implementations must preserve `serialize(parse(source)) === source`.
 */
export interface MarkdownSectionEditor {
  parse(markdown: string): readonly MarkdownSection[];
  serialize(sections: readonly MarkdownSection[]): string;
  draft(section: MarkdownSection): MarkdownSectionDraft;
  can_change_type(
    draft: MarkdownSectionDraft,
    type: MarkdownSectionType,
  ): boolean;
  change_type(
    draft: MarkdownSectionDraft,
    type: MarkdownSectionType,
  ): MarkdownSectionDraft;
  change_list_type(
    draft: MarkdownSectionDraft,
    list_type: MarkdownListType | null,
  ): MarkdownSectionDraft;
  create(draft: MarkdownSectionDraft): MarkdownSection;
  update(
    section: MarkdownSection,
    draft: MarkdownSectionDraft,
  ): MarkdownSection;
  insert(
    sections: readonly MarkdownSection[],
    index: number,
    section: MarkdownSection,
  ): readonly MarkdownSection[];
  remove(
    sections: readonly MarkdownSection[],
    index: number,
  ): readonly MarkdownSection[];
  move(
    sections: readonly MarkdownSection[],
    from_index: number,
    to_index: number,
  ): readonly MarkdownSection[];
  merge(
    sections: readonly MarkdownSection[],
    from_index: number,
    into_index: number,
  ): readonly MarkdownSection[];
}

const heading_pattern = /^(#{1,6})(?:[\t ]+(.*)|[\t ]*)$/;
const bulleted_list_pattern = /^([\t ]*[-+*][\t ]+)(.*)$/;
const numbered_list_pattern = /^([\t ]*\d+[.)][\t ]+)(.*)$/;
const link_pattern = /^\[((?:\\.|[^\\\]])*)\]\(((?:\\.|[^\\)])*)\)$/;
const opening_fence_pattern = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/;
const structural_markdown_pattern =
  /^(?:[\t ]{4}|[\t ]{0,3}(?:>|`{3}|~{3}|\||<|!\[|\[[^\]]+\]:|(?:[-*_][\t ]*){3,}$))/;

function unescape_markdown(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

function escape_link_label(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

function escape_link_url(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(")", "\\)");
}

function assert_index(index: number, length: number, allow_end = false): void {
  const maximum = allow_end ? length : length - 1;
  if (!Number.isInteger(index) || index < 0 || index > maximum) {
    throw new RangeError(`Markdown section index ${index} is out of range`);
  }
}

function assert_single_line(...values: readonly string[]): void {
  if (values.some((value) => /[\r\n]/.test(value))) {
    throw new TypeError(
      "A focused Markdown section field cannot contain a newline",
    );
  }
}

function assert_code_language(language: string): void {
  assert_single_line(language);
  if (language.includes("`")) {
    throw new TypeError("A code block language cannot contain a backtick");
  }
}

function primary_value(draft: MarkdownSectionDraft): string {
  return draft.type === "link" ? draft.label : draft.value;
}

function drafts_equal(
  first: MarkdownSectionDraft,
  second: MarkdownSectionDraft,
): boolean {
  if (first.type !== second.type || first.list_type !== second.list_type) {
    return false;
  }
  switch (first.type) {
    case "heading":
      return second.type === "heading" && first.level === second.level &&
        first.value === second.value;
    case "link":
      return second.type === "link" && first.label === second.label &&
        first.url === second.url;
    case "code-block":
      return second.type === "code-block" &&
        first.language === second.language && first.value === second.value;
    case "text":
    case "raw":
      return second.type === first.type && first.value === second.value;
  }
}

function is_heading_level(value: number): value is MarkdownHeadingLevel {
  return markdown_heading_levels.some((level) => level === value);
}

function default_list_prefix(type: MarkdownListType): string {
  return type === "bulleted" ? "- " : "1. ";
}

function closing_fence_pattern(fence: string): RegExp {
  const marker = fence[0] === "`" ? "`" : "~";
  return new RegExp(`^ {0,3}${marker}{${fence.length},}[\\t ]*$`);
}

function safe_code_fence(value: string): string {
  let length = 3;
  for (const line of value.split("\n")) {
    const candidate = /^ {0,3}(`{3,})[\t ]*$/.exec(line);
    if (candidate) length = Math.max(length, candidate[1].length + 1);
  }
  return "`".repeat(length);
}

/**
 * A deterministic physical-section implementation. It groups only fenced code
 * blocks; all other recognized forms retain the focused one-line behavior.
 */
export class DeterministicMarkdownSectionEditor
  implements MarkdownSectionEditor {
  parse(markdown: string): readonly MarkdownSection[] {
    const physical_lines = markdown.split("\n");
    const sections: MarkdownSection[] = [];

    for (let index = 0; index < physical_lines.length;) {
      const code_block = this.parse_code_block(physical_lines, index);
      if (code_block) {
        sections.push(code_block.section);
        index = code_block.next_index;
      } else {
        sections.push(this.parse_single_line(physical_lines[index]));
        index += 1;
      }
    }

    return sections;
  }

  serialize(sections: readonly MarkdownSection[]): string {
    return sections.map((section) => section.raw).join("\n");
  }

  draft(section: MarkdownSection): MarkdownSectionDraft {
    const list_type = section.list?.type ?? null;
    switch (section.type) {
      case "heading":
        return {
          type: section.type,
          level: section.level,
          value: section.value,
          list_type,
        };
      case "text":
      case "raw":
        return { type: section.type, value: section.value, list_type };
      case "link":
        return {
          type: section.type,
          label: section.label,
          url: section.url,
          list_type,
        };
      case "code-block":
        return {
          type: section.type,
          language: section.language,
          value: section.value,
          list_type: null,
        };
    }
  }

  can_change_type(
    draft: MarkdownSectionDraft,
    type: MarkdownSectionType,
  ): boolean {
    if (draft.type === type || type === "code-block") return true;
    return !/[\r\n]/.test(primary_value(draft));
  }

  change_type(
    draft: MarkdownSectionDraft,
    type: MarkdownSectionType,
  ): MarkdownSectionDraft {
    if (draft.type === type) return draft;
    if (!this.can_change_type(draft, type)) {
      throw new TypeError(
        "Multiline section content must remain a Code block",
      );
    }
    const value = primary_value(draft);
    const list_type = draft.type === "code-block" ? null : draft.list_type;

    switch (type) {
      case "heading":
        return { type, level: 2, value, list_type };
      case "link":
        return { type, label: value, url: "", list_type };
      case "code-block":
        return { type, language: "", value, list_type: null };
      case "text":
      case "raw":
        return { type, value, list_type };
    }
  }

  change_list_type(
    draft: MarkdownSectionDraft,
    list_type: MarkdownListType | null,
  ): MarkdownSectionDraft {
    if (draft.type === "code-block") {
      if (list_type !== null) {
        throw new TypeError(
          "A fenced code block cannot use a line list marker",
        );
      }
      return draft;
    }
    return draft.list_type === list_type ? draft : { ...draft, list_type };
  }

  create(draft: MarkdownSectionDraft): MarkdownSection {
    const sections = this.parse(this.render_draft(draft));
    if (sections.length !== 1) {
      throw new TypeError(
        "A section draft must render as one Markdown section",
      );
    }
    return sections[0];
  }

  update(
    section: MarkdownSection,
    draft: MarkdownSectionDraft,
  ): MarkdownSection {
    if (drafts_equal(this.draft(section), draft)) return section;
    const preserved_prefix = section.list?.type === draft.list_type
      ? section.list.prefix
      : undefined;
    const sections = this.parse(this.render_draft(draft, preserved_prefix));
    if (sections.length !== 1) {
      throw new TypeError("A section update must remain one Markdown section");
    }
    return sections[0];
  }

  insert(
    sections: readonly MarkdownSection[],
    index: number,
    section: MarkdownSection,
  ): readonly MarkdownSection[] {
    assert_index(index, sections.length, true);
    const next_sections = [...sections];
    next_sections.splice(index, 0, section);
    return next_sections;
  }

  remove(
    sections: readonly MarkdownSection[],
    index: number,
  ): readonly MarkdownSection[] {
    assert_index(index, sections.length);
    const next_sections = [...sections];
    next_sections.splice(index, 1);
    return next_sections;
  }

  move(
    sections: readonly MarkdownSection[],
    from_index: number,
    to_index: number,
  ): readonly MarkdownSection[] {
    assert_index(from_index, sections.length);
    assert_index(to_index, sections.length);
    if (from_index === to_index) return [...sections];
    const next_sections = [...sections];
    const [section] = next_sections.splice(from_index, 1);
    next_sections.splice(to_index, 0, section);
    return next_sections;
  }

  merge(
    sections: readonly MarkdownSection[],
    from_index: number,
    into_index: number,
  ): readonly MarkdownSection[] {
    assert_index(from_index, sections.length);
    assert_index(into_index, sections.length);
    if (from_index === into_index) return [...sections];

    const source_value = primary_value(this.draft(sections[from_index]));
    const destination = sections[into_index];
    const destination_draft = this.draft(destination);
    const inline_source_value = source_value.replace(/\r\n?|\n/g, " ");
    const append = (value: string, source: string, separator: " " | "\n") =>
      value === ""
        ? source
        : source === ""
        ? value
        : `${value}${separator}${source}`;

    let merged_draft: MarkdownSectionDraft;
    switch (destination_draft.type) {
      case "heading":
        merged_draft = {
          ...destination_draft,
          value: append(destination_draft.value, inline_source_value, " "),
        };
        break;
      case "link":
        merged_draft = {
          ...destination_draft,
          label: append(destination_draft.label, inline_source_value, " "),
        };
        break;
      case "code-block":
        merged_draft = {
          ...destination_draft,
          value: append(destination_draft.value, source_value, "\n"),
        };
        break;
      case "text":
      case "raw":
        merged_draft = {
          ...destination_draft,
          value: append(destination_draft.value, inline_source_value, " "),
        };
        break;
    }

    const next_sections = [...sections];
    next_sections[into_index] = this.update(destination, merged_draft);
    next_sections.splice(from_index, 1);
    return next_sections;
  }

  private render_draft(
    draft: MarkdownSectionDraft,
    preserved_prefix?: string,
  ): string {
    if (draft.type === "code-block") {
      assert_code_language(draft.language);
      const fence = safe_code_fence(draft.value);
      const opening = `${fence}${draft.language.trim()}`;
      return draft.value === ""
        ? `${opening}\n${fence}`
        : `${opening}\n${draft.value}\n${fence}`;
    }

    let content: string;
    switch (draft.type) {
      case "text":
      case "raw":
        assert_single_line(draft.value);
        content = draft.value;
        break;
      case "heading":
        assert_single_line(draft.value);
        if (!is_heading_level(draft.level)) {
          throw new RangeError(`Invalid Markdown heading level ${draft.level}`);
        }
        content = `${"#".repeat(draft.level)}${
          draft.value === "" ? "" : ` ${draft.value}`
        }`;
        break;
      case "link":
        assert_single_line(draft.label, draft.url);
        content = `[${escape_link_label(draft.label)}](${
          escape_link_url(draft.url)
        })`;
        break;
    }

    return draft.list_type === null
      ? content
      : `${preserved_prefix ?? default_list_prefix(draft.list_type)}${content}`;
  }

  private parse_code_block(
    lines: readonly string[],
    start_index: number,
  ): { section: CodeBlockMarkdownSection; next_index: number } | null {
    const opening = opening_fence_pattern.exec(lines[start_index]);
    if (!opening || (opening[2][0] === "`" && opening[3].includes("`"))) {
      return null;
    }

    const fence = opening[2];
    const closes = closing_fence_pattern(fence);
    let closing_index = -1;
    for (let index = start_index + 1; index < lines.length; index += 1) {
      if (closes.test(lines[index])) {
        closing_index = index;
        break;
      }
    }

    const closed = closing_index !== -1;
    const end_index = closed ? closing_index : lines.length - 1;
    const body_end = closed ? closing_index : lines.length;
    return {
      section: {
        type: "code-block",
        raw: lines.slice(start_index, end_index + 1).join("\n"),
        list: null,
        language: opening[3].trim(),
        value: lines.slice(start_index + 1, body_end).join("\n"),
        fence,
        closed,
      },
      next_index: end_index + 1,
    };
  }

  private parse_single_line(raw: string): MarkdownSection {
    let content = raw;
    let list: MarkdownListMarker | null = null;
    const bulleted_list = bulleted_list_pattern.exec(raw);
    const numbered_list = bulleted_list === null
      ? numbered_list_pattern.exec(raw)
      : null;

    if (bulleted_list) {
      list = { type: "bulleted", prefix: bulleted_list[1] };
      content = bulleted_list[2];
    } else if (numbered_list) {
      list = { type: "numbered", prefix: numbered_list[1] };
      content = numbered_list[2];
    }

    const heading = heading_pattern.exec(content);
    if (heading) {
      return {
        type: "heading",
        raw,
        list,
        level: heading[1].length as MarkdownHeadingLevel,
        value: heading[2] ?? "",
      };
    }

    const link = link_pattern.exec(content);
    if (link) {
      return {
        type: "link",
        raw,
        list,
        label: unescape_markdown(link[1]),
        url: unescape_markdown(link[2]),
      };
    }

    if (structural_markdown_pattern.test(content)) {
      return { type: "raw", raw, list, value: content };
    }

    return { type: "text", raw, list, value: content };
  }
}
