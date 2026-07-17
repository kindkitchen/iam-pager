import { assert, assertEquals, assertFalse } from "@std/assert";
import { MdPageHandler } from "../content/md-page.ts";
import {
  page_preview_request_max_bytes,
  preview_md_page_request,
} from "./page-preview-http.ts";

const handler = new MdPageHandler();

function request(body: unknown, headers?: HeadersInit): Request {
  return new Request("https://pager.test/site/api/preview", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

Deno.test("preview endpoint renders through MdPageHandler without storing", async () => {
  const response = await preview_md_page_request(
    request({ md: "# Hi\n<script>alert(1)</script>", css: "body{}" }),
    handler,
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  assertEquals(response.headers.get("cache-control"), "no-store");
  const body = await response.text();
  assert(body.includes("<h1"));
  assert(body.includes("<style>body{}</style>"));
  assertFalse(body.includes("<script"));
});

Deno.test("preview endpoint validates media type and content", async () => {
  const wrong_media_type = await preview_md_page_request(
    new Request("https://pager.test/site/api/preview", {
      method: "POST",
      body: "{}",
    }),
    handler,
  );
  assertEquals(wrong_media_type.status, 415);

  const invalid_content = await preview_md_page_request(
    request({ md: "" }),
    handler,
  );
  assertEquals(invalid_content.status, 422);
});

Deno.test("preview endpoint rejects declared oversized requests", async () => {
  const response = await preview_md_page_request(
    request(
      { md: "# Hi" },
      { "content-length": String(page_preview_request_max_bytes + 1) },
    ),
    handler,
  );
  assertEquals(response.status, 413);
});
