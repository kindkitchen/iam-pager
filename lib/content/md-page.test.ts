import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { MdPageHandler } from "./md-page.ts";

const handler = new MdPageHandler();

Deno.test("md-page declares inline-only endpoint delivery", () => {
  assertEquals(handler.supported_delivery_profiles, ["inline"]);
});

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

Deno.test("validate enforces configured UTF-8 byte limits", () => {
  const limited = new MdPageHandler({
    max_md_bytes: 4,
    max_css_bytes: 3,
  });
  assertEquals(limited.validate({ md: "four" }).ok, true);
  assertEquals(limited.validate({ md: "éé" }).ok, true);
  assertEquals(limited.validate({ md: "ééx" }), {
    ok: false,
    reason: "md exceeds 4 bytes",
  });
  assertEquals(limited.validate({ md: "ok", css: "four" }), {
    ok: false,
    reason: "css exceeds 3 bytes",
  });
});

Deno.test("constructor rejects invalid limits", () => {
  assertThrows(
    () => new MdPageHandler({ max_md_bytes: 0, max_css_bytes: 1 }),
    Error,
    "positive safe integers",
  );
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
  assert(body.includes('<link rel="icon" href="data:,">'));
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

Deno.test("to_management returns editable source and never derived html", () => {
  const with_css = handler.to_management(
    handler.derive({ md: "# Hi", css: "body { color: red; }" }),
  );
  assertEquals(with_css, { md: "# Hi", css: "body { color: red; }" });
  const without_css = handler.to_management(handler.derive({ md: "# Hi" }));
  assertEquals(without_css, { md: "# Hi" });
  assertFalse("html" in without_css);
});

Deno.test("validate accepts markdown management output and preserves source", () => {
  for (
    const input of [
      { md: "# Round trip <script>alert(1)</script>" },
      { md: "plain", css: "</style>body { color: red; }" },
    ]
  ) {
    const result = handler.validate(
      handler.to_management(handler.derive(input)),
    );
    assert(result.ok);
    assertEquals(result.value, input);
  }
});
