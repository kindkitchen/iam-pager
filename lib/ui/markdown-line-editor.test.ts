import { assertEquals, assertThrows } from "@std/assert";
import {
  DeterministicMarkdownLineEditor,
  type MarkdownLineDraft,
} from "./markdown-line-editor.ts";

const editor = new DeterministicMarkdownLineEditor();

Deno.test("line editor losslessly round-trips arbitrary Markdown", () => {
  const sources = [
    "",
    "Plain text",
    "# Heading\n\n- item\n",
    "```ts\nconst value = 1;\n```",
    "line with Windows return\r\nnext",
    "[complex](https://example.test/a_(b))",
  ];

  for (const source of sources) {
    assertEquals(editor.serialize(editor.parse(source)), source);
  }
});

Deno.test("line editor recognizes safe focused forms", () => {
  const lines = editor.parse(
    "## Heading\n  + item\n7) next\n[Docs](https://example.test)\n> quote\ntext\n\n",
  );

  assertEquals(lines, [
    { type: "heading", raw: "## Heading", level: 2, value: "Heading" },
    { type: "bulleted-list", raw: "  + item", prefix: "  + ", value: "item" },
    { type: "numbered-list", raw: "7) next", prefix: "7) ", value: "next" },
    {
      type: "link",
      raw: "[Docs](https://example.test)",
      label: "Docs",
      url: "https://example.test",
    },
    { type: "raw", raw: "> quote", value: "> quote" },
    { type: "text", raw: "text", value: "text" },
    { type: "blank", raw: "" },
    { type: "blank", raw: "" },
  ]);
});

Deno.test("line editor creates common Markdown items", () => {
  const drafts: MarkdownLineDraft[] = [
    { type: "heading", level: 3, value: "Details" },
    { type: "bulleted-list", value: "First" },
    { type: "numbered-list", value: "Second" },
    {
      type: "link",
      label: "A ] label",
      url: "https://example.test/a_(b)",
    },
    { type: "text", value: "Closing text" },
    { type: "blank" },
  ];

  assertEquals(
    editor.serialize(drafts.map((draft) => editor.create(draft))),
    "### Details\n- First\n1. Second\n[A \\] label](https://example.test/a_(b\\))\nClosing text\n",
  );
});

Deno.test("line editor changes type while preserving the primary value", () => {
  const text: MarkdownLineDraft = { type: "text", value: "Docs" };
  const link = editor.change_type(text, "link");

  assertEquals(link, { type: "link", label: "Docs", url: "" });
  assertEquals(editor.change_type(link, "heading"), {
    type: "heading",
    level: 2,
    value: "Docs",
  });
  assertEquals(editor.change_type(link, "numbered-list"), {
    type: "numbered-list",
    value: "Docs",
  });
  assertEquals(editor.change_type(text, "blank"), { type: "blank" });
  assertEquals(editor.change_type(text, "text"), text);
});

Deno.test("line editor updates list content without replacing its marker", () => {
  const [line] = editor.parse("  * old");
  const updated = editor.update(line, {
    type: "bulleted-list",
    value: "new",
  });

  assertEquals(updated, {
    type: "bulleted-list",
    raw: "  * new",
    prefix: "  * ",
    value: "new",
  });
});

Deno.test("line editor preserves exact syntax when an edit has no changes", () => {
  const [line] = editor.parse("[A \\* label](relative\\ path)");
  assertEquals(editor.update(line, editor.draft(line)), line);
});

Deno.test("line editor rejects multiline values for one physical line", () => {
  assertThrows(
    () => editor.create({ type: "text", value: "one\ntwo" }),
    TypeError,
  );
  assertThrows(
    () => editor.create({ type: "link", label: "label", url: "one\rtwo" }),
    TypeError,
  );
});

Deno.test("line editor inserts, moves, and removes immutable line arrays", () => {
  const original = editor.parse("one\nthree");
  const inserted = editor.insert(
    original,
    1,
    editor.create({ type: "text", value: "two" }),
  );
  const moved = editor.move(inserted, 2, 0);
  const removed = editor.remove(moved, 1);

  assertEquals(editor.serialize(original), "one\nthree");
  assertEquals(editor.serialize(inserted), "one\ntwo\nthree");
  assertEquals(editor.serialize(moved), "three\none\ntwo");
  assertEquals(editor.serialize(removed), "three\ntwo");
  assertThrows(() => editor.remove(original, 2), RangeError);
  assertThrows(() => editor.insert(original, -1, original[0]), RangeError);
});
