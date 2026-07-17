import { assertEquals, assertRejects } from "@std/assert";
import { HttpPagePreviewer, type PreviewFetch } from "./page-preview.ts";

Deno.test("HTTP preview adapter sends Markdown and CSS to the UI endpoint", async () => {
  let received_url = "";
  let received_init: RequestInit | undefined;
  const preview_fetch: PreviewFetch = (input, init) => {
    received_url = String(input);
    received_init = init;
    return Promise.resolve(new Response("<!doctype html><p>Hi</p>"));
  };
  const previewer = new HttpPagePreviewer("/preview", preview_fetch);

  assertEquals(
    await previewer.render({ md: "# Hi", css: "body{}" }),
    "<!doctype html><p>Hi</p>",
  );
  assertEquals(received_url, "/preview");
  assertEquals(received_init?.method, "POST");
  assertEquals(received_init?.headers, { "content-type": "application/json" });
  assertEquals(
    received_init?.body,
    JSON.stringify({ md: "# Hi", css: "body{}" }),
  );
});

Deno.test("HTTP preview adapter reports failed responses", async () => {
  const previewer = new HttpPagePreviewer(
    "/preview",
    () => Promise.resolve(new Response(null, { status: 422 })),
  );
  await assertRejects(
    () => previewer.render({ md: "# Hi" }),
    Error,
    "Preview failed (422)",
  );
});
