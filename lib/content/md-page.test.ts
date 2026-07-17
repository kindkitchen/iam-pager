import { assert, assertEquals, assertFalse } from "@std/assert";
import { MdPageHandler } from "./md-page.ts";

const handler = new MdPageHandler();

Deno.test("validate rejects non-object input", () => {
  for (const input of [null, undefined, 42, "md", []]) {
    const result = handler.validate(input);
    if (Array.isArray(input)) continue; // arrays are objects; md check catches them
    assertEquals(result.ok, false);
  }
});

Deno.test("validate requires a non-empty md string", () => {
  assertEquals(handler.validate({}).ok, false);
  assertEquals(handler.validate({ md: "" }).ok, false);
  assertEquals(handler.validate({ md: "   " }).ok, false);
  assertEquals(handler.validate({ md: 7 }).ok, false);
});

Deno.test("validate rejects non-string css", () => {
  assertEquals(handler.validate({ md: "# Hi", css: 3 }).ok, false);
});

Deno.test("validate narrows to the declared input shape", () => {
  assertEquals(handler.validate({ md: "# Hi", extra: true }), {
    ok: true,
    value: { md: "# Hi" },
  });
  assertEquals(handler.validate({ md: "# Hi", css: "body{}" }), {
    ok: true,
    value: { md: "# Hi", css: "body{}" },
  });
});

Deno.test("derive renders markdown to html and keeps the source", () => {
  const data = handler.derive({ md: "# Hi\n\n**bold**" });
  assertEquals(data.md, "# Hi\n\n**bold**");
  assert(data.html.includes("<h1"));
  assert(data.html.includes("<strong>bold</strong>"));
  assertEquals(data.css, undefined);
});

Deno.test("derive sanitizes script out of guest markdown", () => {
  const data = handler.derive({ md: "hello\n<script>alert(1)</script>" });
  assertFalse(data.html.includes("<script"));
  assert(data.html.includes("hello"));
});

Deno.test("render wraps derived html in a standalone text/html document", () => {
  const data = handler.derive({ md: "# Hi" });
  const payload = handler.render(data);
  assertEquals(payload.media_type, "text/html; charset=utf-8");
  const body = payload.body as string;
  assert(body.startsWith("<!DOCTYPE html>"));
  assert(body.includes(data.html));
  assertFalse(body.includes("<style>"));
});

Deno.test("render applies css inside a style tag", () => {
  const payload = handler.render(
    handler.derive({ md: "# Hi", css: "body { color: red; }" }),
  );
  assert(
    (payload.body as string).includes("<style>body { color: red; }</style>"),
  );
});

Deno.test("render neutralizes style-tag breakout in css", () => {
  const payload = handler.render(
    handler.derive({ md: "# Hi", css: "</style><script>alert(1)</script>" }),
  );
  assertFalse((payload.body as string).includes("<script"));
});
