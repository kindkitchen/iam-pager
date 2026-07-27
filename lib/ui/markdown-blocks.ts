/**
 * Minimal block model for code-owned Markdown documents.
 *
 * It exists so a trusted document can be shown as real elements instead of
 * injected HTML: the parser owns the structure, and any front-end renders the
 * blocks with its own components. It deliberately covers only the subset the
 * platform authors itself — headings, paragraphs, lists, tables, and fenced
 * code — and never sanitizes untrusted input, which belongs to the content
 * handlers instead.
 */

/** Inline run inside one block. */
export type MarkdownInline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

export type MarkdownBlock =
  | { readonly kind: "front_matter"; readonly text: string }
  | {
    readonly kind: "heading";
    readonly level: 1 | 2 | 3 | 4 | 5 | 6;
    readonly content: readonly MarkdownInline[];
  }
  | { readonly kind: "paragraph"; readonly content: readonly MarkdownInline[] }
  | {
    readonly kind: "list";
    readonly ordered: boolean;
    readonly items: readonly (readonly MarkdownInline[])[];
  }
  | {
    readonly kind: "table";
    readonly header: readonly (readonly MarkdownInline[])[];
    readonly rows: readonly (readonly (readonly MarkdownInline[])[])[];
  }
  | {
    readonly kind: "code";
    readonly language: string | null;
    readonly text: string;
  };

/** Parses one trusted Markdown document into ordered blocks. */
export function parse_markdown_blocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end !== -1) {
      blocks.push({
        kind: "front_matter",
        text: lines.slice(1, end).join("\n"),
      });
      index = end + 1;
    }
  }

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence !== null) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({
        kind: "code",
        language: fence[1] === "" ? null : fence[1],
        text: body.join("\n"),
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        content: parse_markdown_inline(heading[2].trim()),
      });
      index += 1;
      continue;
    }

    if (
      is_table_row(line) && index + 1 < lines.length &&
      is_table_delimiter(lines[index + 1])
    ) {
      const header = split_table_row(line);
      const rows: (readonly MarkdownInline[])[][] = [];
      index += 2;
      while (index < lines.length && is_table_row(lines[index])) {
        rows.push(split_table_row(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    if (is_list_item(line)) {
      const ordered = /^\s*\d+\.\s/.test(line);
      const items: (readonly MarkdownInline[])[] = [];
      let current: string | null = null;
      while (index < lines.length && lines[index].trim() !== "") {
        const candidate = lines[index];
        if (is_list_item(candidate)) {
          if (current !== null) items.push(parse_markdown_inline(current));
          current = candidate.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
        } else if (current !== null) {
          current = `${current} ${candidate.trim()}`;
        } else {
          break;
        }
        index += 1;
      }
      if (current !== null) items.push(parse_markdown_inline(current));
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length && lines[index].trim() !== "" &&
      !is_list_item(lines[index]) && !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^```/.test(lines[index]) && !is_table_row(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({
        kind: "paragraph",
        content: parse_markdown_inline(paragraph.join(" ")),
      });
      continue;
    }
    index += 1;
  }

  return blocks;
}

/** Parses inline code, bold, and links; everything else stays literal text. */
export function parse_markdown_inline(text: string): MarkdownInline[] {
  const runs: MarkdownInline[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      runs.push({ kind: "text", text: text.slice(cursor, start) });
    }
    if (match[1] !== undefined) {
      runs.push({ kind: "code", text: match[1] });
    } else if (match[2] !== undefined) {
      runs.push({ kind: "strong", text: match[2] });
    } else {
      runs.push({ kind: "link", text: match[3], href: match[4] });
    }
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    runs.push({ kind: "text", text: text.slice(cursor) });
  }
  return runs;
}

function is_list_item(line: string): boolean {
  return /^\s*(?:[-*+]|\d+\.)\s+/.test(line);
}

function is_table_row(line: string): boolean {
  return line.trimStart().startsWith("|");
}

function is_table_delimiter(line: string): boolean {
  return /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(line);
}

function split_table_row(line: string): (readonly MarkdownInline[])[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => parse_markdown_inline(cell.trim()));
}
