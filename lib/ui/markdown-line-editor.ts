export const markdown_heading_levels = [1, 2, 3, 4, 5, 6] as const;

export type MarkdownHeadingLevel = typeof markdown_heading_levels[number];

export type MarkdownLineType =
  | "blank"
  | "text"
  | "heading"
  | "bulleted-list"
  | "numbered-list"
  | "link"
  | "raw";

interface MarkdownLineBase {
  /** Exact source for this physical line, excluding its newline separator. */
  readonly raw: string;
}

export interface BlankMarkdownLine extends MarkdownLineBase {
  readonly type: "blank";
}

export interface TextMarkdownLine extends MarkdownLineBase {
  readonly type: "text";
  readonly value: string;
}

export interface HeadingMarkdownLine extends MarkdownLineBase {
  readonly type: "heading";
  readonly level: MarkdownHeadingLevel;
  readonly value: string;
}

export interface BulletedListMarkdownLine extends MarkdownLineBase {
  readonly type: "bulleted-list";
  readonly prefix: string;
  readonly value: string;
}

export interface NumberedListMarkdownLine extends MarkdownLineBase {
  readonly type: "numbered-list";
  readonly prefix: string;
  readonly value: string;
}

export interface LinkMarkdownLine extends MarkdownLineBase {
  readonly type: "link";
  readonly label: string;
  readonly url: string;
}

export interface RawMarkdownLine extends MarkdownLineBase {
  readonly type: "raw";
  readonly value: string;
}

export type MarkdownLine =
  | BlankMarkdownLine
  | TextMarkdownLine
  | HeadingMarkdownLine
  | BulletedListMarkdownLine
  | NumberedListMarkdownLine
  | LinkMarkdownLine
  | RawMarkdownLine;

export type MarkdownLineDraft =
  | { readonly type: "blank" }
  | { readonly type: "text"; readonly value: string }
  | {
    readonly type: "heading";
    readonly level: MarkdownHeadingLevel;
    readonly value: string;
  }
  | { readonly type: "bulleted-list"; readonly value: string }
  | { readonly type: "numbered-list"; readonly value: string }
  | { readonly type: "link"; readonly label: string; readonly url: string }
  | { readonly type: "raw"; readonly value: string };

/**
 * Lossless boundary between raw Markdown and the optional line editor.
 * Implementations must preserve `serialize(parse(source)) === source`.
 */
export interface MarkdownLineEditor {
  parse(markdown: string): readonly MarkdownLine[];
  serialize(lines: readonly MarkdownLine[]): string;
  draft(line: MarkdownLine): MarkdownLineDraft;
  change_type(
    draft: MarkdownLineDraft,
    type: MarkdownLineType,
  ): MarkdownLineDraft;
  create(draft: MarkdownLineDraft): MarkdownLine;
  update(line: MarkdownLine, draft: MarkdownLineDraft): MarkdownLine;
  insert(
    lines: readonly MarkdownLine[],
    index: number,
    line: MarkdownLine,
  ): readonly MarkdownLine[];
  remove(
    lines: readonly MarkdownLine[],
    index: number,
  ): readonly MarkdownLine[];
  move(
    lines: readonly MarkdownLine[],
    from_index: number,
    to_index: number,
  ): readonly MarkdownLine[];
}

const heading_pattern = /^(#{1,6})(?:[\t ]+(.*)|[\t ]*)$/;
const bulleted_list_pattern = /^([\t ]*[-+*][\t ]+)(.*)$/;
const numbered_list_pattern = /^([\t ]*\d+[.)][\t ]+)(.*)$/;
const link_pattern = /^\[((?:\\.|[^\\\]])*)\]\(((?:\\.|[^\\)])*)\)$/;
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
    throw new RangeError(`Markdown line index ${index} is out of range`);
  }
}

function assert_single_line(...values: readonly string[]): void {
  if (values.some((value) => /[\r\n]/.test(value))) {
    throw new TypeError("A Markdown line field cannot contain a newline");
  }
}

function drafts_equal(
  first: MarkdownLineDraft,
  second: MarkdownLineDraft,
): boolean {
  if (first.type !== second.type) return false;
  switch (first.type) {
    case "blank":
      return true;
    case "heading":
      return second.type === "heading" && first.level === second.level &&
        first.value === second.value;
    case "link":
      return second.type === "link" && first.label === second.label &&
        first.url === second.url;
    case "text":
    case "bulleted-list":
    case "numbered-list":
    case "raw":
      return second.type === first.type && first.value === second.value;
  }
}

function is_heading_level(value: number): value is MarkdownHeadingLevel {
  return markdown_heading_levels.some((level) => level === value);
}

/** A deterministic physical-line implementation; it does not parse Markdown HTML. */
export class DeterministicMarkdownLineEditor implements MarkdownLineEditor {
  parse(markdown: string): readonly MarkdownLine[] {
    if (markdown === "") return [];
    return markdown.split("\n").map((raw) => this.parse_line(raw));
  }

  serialize(lines: readonly MarkdownLine[]): string {
    return lines.map((line) => line.raw).join("\n");
  }

  draft(line: MarkdownLine): MarkdownLineDraft {
    switch (line.type) {
      case "blank":
        return { type: "blank" };
      case "heading":
        return { type: line.type, level: line.level, value: line.value };
      case "bulleted-list":
      case "numbered-list":
      case "text":
      case "raw":
        return { type: line.type, value: line.value };
      case "link":
        return { type: line.type, label: line.label, url: line.url };
    }
  }

  change_type(
    draft: MarkdownLineDraft,
    type: MarkdownLineType,
  ): MarkdownLineDraft {
    if (draft.type === type) return draft;
    const value = draft.type === "blank"
      ? ""
      : draft.type === "link"
      ? draft.label
      : draft.value;

    switch (type) {
      case "blank":
        return { type };
      case "heading":
        return { type, level: 2, value };
      case "link":
        return { type, label: value, url: "" };
      case "text":
      case "bulleted-list":
      case "numbered-list":
      case "raw":
        return { type, value };
    }
  }

  create(draft: MarkdownLineDraft): MarkdownLine {
    if (draft.type === "link") {
      assert_single_line(draft.label, draft.url);
    } else if (draft.type !== "blank") {
      assert_single_line(draft.value);
    }

    switch (draft.type) {
      case "blank":
        return { type: "blank", raw: "" };
      case "text":
      case "raw":
        return this.parse_line(draft.value);
      case "heading": {
        if (!is_heading_level(draft.level)) {
          throw new RangeError(`Invalid Markdown heading level ${draft.level}`);
        }
        const raw = `${"#".repeat(draft.level)}${
          draft.value === "" ? "" : ` ${draft.value}`
        }`;
        return this.parse_line(raw);
      }
      case "bulleted-list":
        return this.parse_line(`- ${draft.value}`);
      case "numbered-list":
        return this.parse_line(`1. ${draft.value}`);
      case "link":
        return this.parse_line(
          `[${escape_link_label(draft.label)}](${escape_link_url(draft.url)})`,
        );
    }
  }

  update(line: MarkdownLine, draft: MarkdownLineDraft): MarkdownLine {
    if (drafts_equal(this.draft(line), draft)) return line;
    if (line.type === draft.type) {
      if (line.type === "bulleted-list" && draft.type === "bulleted-list") {
        return this.parse_line(`${line.prefix}${draft.value}`);
      }
      if (line.type === "numbered-list" && draft.type === "numbered-list") {
        return this.parse_line(`${line.prefix}${draft.value}`);
      }
    }
    return this.create(draft);
  }

  insert(
    lines: readonly MarkdownLine[],
    index: number,
    line: MarkdownLine,
  ): readonly MarkdownLine[] {
    assert_index(index, lines.length, true);
    const next_lines = [...lines];
    next_lines.splice(index, 0, line);
    return next_lines;
  }

  remove(
    lines: readonly MarkdownLine[],
    index: number,
  ): readonly MarkdownLine[] {
    assert_index(index, lines.length);
    const next_lines = [...lines];
    next_lines.splice(index, 1);
    return next_lines;
  }

  move(
    lines: readonly MarkdownLine[],
    from_index: number,
    to_index: number,
  ): readonly MarkdownLine[] {
    assert_index(from_index, lines.length);
    assert_index(to_index, lines.length);
    if (from_index === to_index) return [...lines];
    const next_lines = [...lines];
    const [line] = next_lines.splice(from_index, 1);
    next_lines.splice(to_index, 0, line);
    return next_lines;
  }

  private parse_line(raw: string): MarkdownLine {
    if (raw === "") return { type: "blank", raw };

    const heading = heading_pattern.exec(raw);
    if (heading) {
      return {
        type: "heading",
        raw,
        level: heading[1].length as MarkdownHeadingLevel,
        value: heading[2] ?? "",
      };
    }

    const bulleted_list = bulleted_list_pattern.exec(raw);
    if (bulleted_list) {
      return {
        type: "bulleted-list",
        raw,
        prefix: bulleted_list[1],
        value: bulleted_list[2],
      };
    }

    const numbered_list = numbered_list_pattern.exec(raw);
    if (numbered_list) {
      return {
        type: "numbered-list",
        raw,
        prefix: numbered_list[1],
        value: numbered_list[2],
      };
    }

    const link = link_pattern.exec(raw);
    if (link) {
      return {
        type: "link",
        raw,
        label: unescape_markdown(link[1]),
        url: unescape_markdown(link[2]),
      };
    }

    if (structural_markdown_pattern.test(raw)) {
      return { type: "raw", raw, value: raw };
    }

    return { type: "text", raw, value: raw };
  }
}
