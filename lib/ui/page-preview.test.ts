import { assert, assertFalse } from "@std/assert";
import { ClientPagePreviewer } from "./page-preview.ts";

const previewer = new ClientPagePreviewer();

Deno.test("client preview renders Markdown and editable CSS", () => {
  const document = previewer.render({
    md: "# Hello\n\nWrite. Style. Preview. Publish.",
    css: "body { color: green; }",
  });

  assert(document.includes("<h1>Hello</h1>"));
  assert(document.includes("<p>Write. Style. Preview. Publish.</p>"));
  assert(document.includes("<style>body { color: green; }</style>"));
});

Deno.test("client preview leaves publish-time sanitization to MdPageHandler", () => {
  const document = previewer.render({
    md: "<mark>draft</mark>",
  });
  assert(document.includes("<mark>draft</mark>"));
});

Deno.test("client preview omits an unused stylesheet", () => {
  const document = previewer.render({ md: "Plain text" });
  assertFalse(document.includes("<style>"));
});
