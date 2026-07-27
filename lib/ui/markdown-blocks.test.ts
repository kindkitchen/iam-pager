import { assertEquals } from "@std/assert";
import {
  parse_markdown_blocks,
  parse_markdown_inline,
} from "./markdown-blocks.ts";

Deno.test("block parser separates front matter, headings, prose, and code", () => {
  const blocks = parse_markdown_blocks(
    [
      "---",
      "name: demo",
      "---",
      "",
      "# Title",
      "",
      "First line",
      "continued line",
      "",
      "```bash",
      "curl https://pager.test",
      "```",
      "",
    ].join("\n"),
  );
  assertEquals(blocks, [
    { kind: "front_matter", text: "name: demo" },
    { kind: "heading", level: 1, content: [{ kind: "text", text: "Title" }] },
    {
      kind: "paragraph",
      content: [{ kind: "text", text: "First line continued line" }],
    },
    { kind: "code", language: "bash", text: "curl https://pager.test" },
  ]);
});

Deno.test("block parser keeps lists and tables as structured data", () => {
  const blocks = parse_markdown_blocks(
    [
      "1. first",
      "2. second",
      "",
      "- bullet one",
      "- bullet two",
      "",
      "| Intent | Call |",
      "| --- | --- |",
      "| List | `GET /api/pages` |",
    ].join("\n"),
  );
  assertEquals(blocks.length, 3);
  assertEquals(blocks[0], {
    kind: "list",
    ordered: true,
    items: [
      [{ kind: "text", text: "first" }],
      [{ kind: "text", text: "second" }],
    ],
  });
  assertEquals(blocks[1].kind, "list");
  assertEquals((blocks[1] as { ordered: boolean }).ordered, false);
  assertEquals(blocks[2], {
    kind: "table",
    header: [
      [{ kind: "text", text: "Intent" }],
      [{ kind: "text", text: "Call" }],
    ],
    rows: [[
      [{ kind: "text", text: "List" }],
      [{ kind: "code", text: "GET /api/pages" }],
    ]],
  });
});

Deno.test("inline parser recognizes code, bold, and links only", () => {
  assertEquals(
    parse_markdown_inline("Use `curl`, read **this**, open [docs](/site)."),
    [
      { kind: "text", text: "Use " },
      { kind: "code", text: "curl" },
      { kind: "text", text: ", read " },
      { kind: "strong", text: "this" },
      { kind: "text", text: ", open " },
      { kind: "link", text: "docs", href: "/site" },
      { kind: "text", text: "." },
    ],
  );
  assertEquals(parse_markdown_inline("plain <b>text</b>"), [
    { kind: "text", text: "plain <b>text</b>" },
  ]);
});
