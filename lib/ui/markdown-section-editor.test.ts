import { assertEquals, assertFalse, assertThrows } from "@std/assert";
import {
  DeterministicMarkdownSectionEditor,
  type MarkdownSectionDraft,
} from "./markdown-section-editor.ts";

const editor = new DeterministicMarkdownSectionEditor();

Deno.test("section editor losslessly round-trips arbitrary Markdown", () => {
  const sources = [
    "",
    "Plain text",
    "# Heading\n\n- item\n",
    "```ts\nconst value = 1;\n```",
    "~~~ css\nbody {}\n~~~~\n",
    "```\nunterminated",
    "line with Windows return\r\nnext",
    "[complex](https://example.test/a_(b))",
    "- ## Listed heading\n7) [Listed link](https://example.test)",
  ];

  for (const source of sources) {
    assertEquals(editor.serialize(editor.parse(source)), source);
  }
});

Deno.test("section editor represents an empty document as empty Text", () => {
  assertEquals(editor.parse(""), [
    { type: "text", raw: "", list: null, value: "" },
  ]);
});

Deno.test("section editor recognizes content types independently from lists", () => {
  const sections = editor.parse(
    "## Heading\n  + item\n7) next\n- ### Listed heading\n2. [Docs](https://example.test)\n> quote\ntext\n\n",
  );

  assertEquals(sections, [
    {
      type: "heading",
      raw: "## Heading",
      list: null,
      level: 2,
      value: "Heading",
    },
    {
      type: "text",
      raw: "  + item",
      list: { type: "bulleted", prefix: "  + " },
      value: "item",
    },
    {
      type: "text",
      raw: "7) next",
      list: { type: "numbered", prefix: "7) " },
      value: "next",
    },
    {
      type: "heading",
      raw: "- ### Listed heading",
      list: { type: "bulleted", prefix: "- " },
      level: 3,
      value: "Listed heading",
    },
    {
      type: "link",
      raw: "2. [Docs](https://example.test)",
      list: { type: "numbered", prefix: "2. " },
      label: "Docs",
      url: "https://example.test",
    },
    { type: "raw", raw: "> quote", list: null, value: "> quote" },
    { type: "text", raw: "text", list: null, value: "text" },
    { type: "text", raw: "", list: null, value: "" },
    { type: "text", raw: "", list: null, value: "" },
  ]);
});

Deno.test("section editor groups a fenced code block as one section", () => {
  assertEquals(editor.parse("before\n```ts\none\ntwo\n```\nafter"), [
    { type: "text", raw: "before", list: null, value: "before" },
    {
      type: "code-block",
      raw: "```ts\none\ntwo\n```",
      list: null,
      language: "ts",
      value: "one\ntwo",
      fence: "```",
      closed: true,
    },
    { type: "text", raw: "after", list: null, value: "after" },
  ]);
});

Deno.test("section editor keeps unterminated fenced code as one section", () => {
  assertEquals(editor.parse("~~~ css\nbody {}\nnext"), [
    {
      type: "code-block",
      raw: "~~~ css\nbody {}\nnext",
      list: null,
      language: "css",
      value: "body {}\nnext",
      fence: "~~~",
      closed: false,
    },
  ]);
});

Deno.test("section editor creates standalone, listed, and code content", () => {
  const drafts: MarkdownSectionDraft[] = [
    { type: "heading", level: 3, value: "Details", list_type: null },
    { type: "heading", level: 2, value: "Listed", list_type: "bulleted" },
    {
      type: "link",
      label: "A ] label",
      url: "https://example.test/a_(b)",
      list_type: "numbered",
    },
    {
      type: "code-block",
      language: "ts",
      value: "const value = 1;",
      list_type: null,
    },
    { type: "text", value: "", list_type: null },
  ];

  assertEquals(
    editor.serialize(drafts.map((draft) => editor.create(draft))),
    "### Details\n- ## Listed\n1. [A \\] label](https://example.test/a_(b\\))\n```ts\nconst value = 1;\n```\n",
  );
});

Deno.test("section editor chooses a fence that cannot close inside code", () => {
  const section = editor.create({
    type: "code-block",
    language: "md",
    value: "before\n```\nafter",
    list_type: null,
  });

  assertEquals(section, {
    type: "code-block",
    raw: "````md\nbefore\n```\nafter\n````",
    list: null,
    language: "md",
    value: "before\n```\nafter",
    fence: "````",
    closed: true,
  });
});

Deno.test("section editor changes type without losing safe primary content", () => {
  const text: MarkdownSectionDraft = {
    type: "text",
    value: "Docs",
    list_type: "bulleted",
  };
  const link = editor.change_type(text, "link");

  assertEquals(link, {
    type: "link",
    label: "Docs",
    url: "",
    list_type: "bulleted",
  });
  assertEquals(editor.change_type(link, "heading"), {
    type: "heading",
    level: 2,
    value: "Docs",
    list_type: "bulleted",
  });
  assertEquals(editor.change_type(text, "code-block"), {
    type: "code-block",
    language: "",
    value: "Docs",
    list_type: null,
  });
  assertEquals(editor.change_type(text, "text"), text);
});

Deno.test("section editor guards multiline code from lossy type changes", () => {
  const code: MarkdownSectionDraft = {
    type: "code-block",
    language: "ts",
    value: "one\ntwo",
    list_type: null,
  };

  assertFalse(editor.can_change_type(code, "text"));
  assertEquals(editor.can_change_type(code, "code-block"), true);
  assertThrows(() => editor.change_type(code, "text"), TypeError);
});

Deno.test("section editor changes list membership independently", () => {
  const heading: MarkdownSectionDraft = {
    type: "heading",
    level: 2,
    value: "Docs",
    list_type: null,
  };

  const bulleted = editor.change_list_type(heading, "bulleted");
  assertEquals(bulleted, { ...heading, list_type: "bulleted" });
  assertEquals(editor.change_list_type(bulleted, "numbered"), {
    ...heading,
    list_type: "numbered",
  });
  assertEquals(editor.change_list_type(bulleted, null), heading);
  assertThrows(
    () =>
      editor.change_list_type({
        type: "code-block",
        language: "",
        value: "",
        list_type: null,
      }, "bulleted"),
    TypeError,
  );
});

Deno.test("section editor updates list content without replacing its marker", () => {
  const [section] = editor.parse("  * old");
  const updated = editor.update(section, {
    type: "text",
    value: "new",
    list_type: "bulleted",
  });

  assertEquals(updated, {
    type: "text",
    raw: "  * new",
    list: { type: "bulleted", prefix: "  * " },
    value: "new",
  });
});

Deno.test("section editor preserves exact syntax when an edit has no changes", () => {
  const [link] = editor.parse("7) [A \\* label](relative\\ path)");
  const [code] = editor.parse("  ~~~~  ts  \nvalue\n  ~~~~~");
  assertEquals(editor.update(link, editor.draft(link)), link);
  assertEquals(editor.update(code, editor.draft(code)), code);
});

Deno.test("section editor validates focused and code fields", () => {
  assertThrows(
    () => editor.create({ type: "text", value: "one\ntwo", list_type: null }),
    TypeError,
  );
  assertThrows(
    () =>
      editor.create({
        type: "link",
        label: "label",
        url: "one\rtwo",
        list_type: "bulleted",
      }),
    TypeError,
  );
  assertThrows(
    () =>
      editor.create({
        type: "code-block",
        language: "bad`language",
        value: "one\ntwo",
        list_type: null,
      }),
    TypeError,
  );
});

Deno.test("section editor moves a complete code section immutably", () => {
  const original = editor.parse("one\n```ts\ntwo\nmore\n```\nthree");
  const moved = editor.move(original, 1, 0);
  const inserted = editor.insert(
    moved,
    2,
    editor.create({ type: "text", value: "middle", list_type: null }),
  );
  const removed = editor.remove(inserted, 1);

  assertEquals(
    editor.serialize(original),
    "one\n```ts\ntwo\nmore\n```\nthree",
  );
  assertEquals(
    editor.serialize(moved),
    "```ts\ntwo\nmore\n```\none\nthree",
  );
  assertEquals(
    editor.serialize(removed),
    "```ts\ntwo\nmore\n```\nmiddle\nthree",
  );
  assertThrows(() => editor.remove(original, 3), RangeError);
  assertThrows(() => editor.insert(original, -1, original[0]), RangeError);
});
