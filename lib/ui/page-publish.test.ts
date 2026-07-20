import { assertEquals } from "@std/assert";
import {
  page_publish_authorization,
  page_publish_success_from_api,
  prepare_page_publish_request,
} from "./page-publish.ts";

Deno.test("page publish presenter derives only guest or CSRF creator authority", () => {
  assertEquals(page_publish_authorization({ kind: "hidden" }), {
    kind: "guest",
  });
  assertEquals(
    page_publish_authorization({
      kind: "creator",
      csrf_token: "creator-csrf",
      reservations: [],
    }),
    { kind: "creator", csrf_token: "creator-csrf" },
  );
});

Deno.test("page publish request uses the nested explicit API shape and creator CSRF", () => {
  const draft = {
    namespace: "  Alice  ",
    page_name: " notes/today ",
    markdown: "# Notes",
    css: "body { color: navy; }",
  };
  const prepared = prepare_page_publish_request(draft, {
    kind: "creator",
    csrf_token: "creator-csrf",
  });

  assertEquals(prepared.headers.get("content-type"), "application/json");
  assertEquals(prepared.headers.get("x-csrf-token"), "creator-csrf");
  assertEquals(prepared.body, {
    locator: { namespace: "Alice", page_name: "notes/today" },
    access: "public",
    content: {
      content_type: "md-page",
      input: { md: "# Notes", css: "body { color: navy; }" },
    },
  });
  assertEquals(draft.namespace, "  Alice  ");
});

Deno.test("publish success validator exposes only a safe local page path", () => {
  assertEquals(
    page_publish_success_from_api({
      ok: true,
      path: "/Alice/report",
      url: "https://pager.test/Alice/report",
      page: { owner_user_id: "hidden" },
    }),
    { path: "/Alice/report" },
  );
  assertEquals(
    page_publish_success_from_api({ ok: true, path: "//outside.test/report" }),
    null,
  );
  assertEquals(
    page_publish_success_from_api({ ok: false, path: "/Alice/report" }),
    null,
  );
});

Deno.test("guest page publish request omits CSRF and optional empty fields", () => {
  const prepared = prepare_page_publish_request(
    {
      namespace: "Guest",
      page_name: "  ",
      markdown: "hello",
      css: "",
    },
    { kind: "guest" },
  );

  assertEquals(prepared.headers.has("x-csrf-token"), false);
  assertEquals(prepared.body.locator, { namespace: "Guest" });
  assertEquals(prepared.body.content.input, { md: "hello" });
});
