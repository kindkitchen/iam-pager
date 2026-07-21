import { assertEquals } from "@std/assert";
import {
  page_publish_authorization,
  page_publish_success_from_api,
  prepare_page_publish_request,
} from "./page-publish.ts";

Deno.test("page publish presenter derives guest or owned creator authority", () => {
  assertEquals(page_publish_authorization({ kind: "hidden" }), {
    kind: "guest",
  });
  assertEquals(
    page_publish_authorization({
      kind: "creator",
      csrf_token: "creator-csrf",
      reservations: [{
        namespace: "Alice",
        path: "/Alice",
        reserved_at: "2026-07-21T00:00:00.000Z",
      }],
    }),
    {
      kind: "creator",
      csrf_token: "creator-csrf",
      owned_namespaces: ["Alice"],
    },
  );
});

Deno.test("Markdown publish sends an explicit multi-reference endpoint set", () => {
  const draft = {
    primary: {
      namespace: "  Alice  ",
      page_name: " notes/today ",
      delivery_profile: "inline" as const,
    },
    aliases: [{
      namespace: " Knowledge ",
      page_name: "  ",
      delivery_profile: "inline" as const,
    }],
    markdown: "# Notes",
    css: "body { color: navy; }",
  };
  const prepared = prepare_page_publish_request(draft, {
    kind: "creator",
    csrf_token: "creator-csrf",
    owned_namespaces: ["Alice", "Knowledge"],
  });

  assertEquals(prepared.headers.get("content-type"), "application/json");
  assertEquals(prepared.headers.get("x-csrf-token"), "creator-csrf");
  assertEquals(prepared.body, {
    endpoint_set: {
      canonical: {
        locator: { namespace: "Alice", page_name: "notes/today" },
        delivery_profile: "inline",
      },
      alternates: [{
        locator: { namespace: "Knowledge" },
        delivery_profile: "inline",
      }],
    },
    access: "public",
    content: {
      content_type: "md-page",
      input: { md: "# Notes", css: "body { color: navy; }" },
    },
  });
  assertEquals(draft.primary.namespace, "  Alice  ");
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

Deno.test("guest one-path Markdown publish omits CSRF and optional fields", () => {
  const prepared = prepare_page_publish_request(
    {
      primary: {
        namespace: "Guest",
        page_name: "  ",
        delivery_profile: "inline",
      },
      aliases: [],
      markdown: "hello",
      css: "",
    },
    { kind: "guest" },
  );

  assertEquals(prepared.headers.has("x-csrf-token"), false);
  assertEquals(prepared.body.endpoint_set, {
    canonical: {
      locator: { namespace: "Guest" },
      delivery_profile: "inline",
    },
    alternates: [],
  });
  assertEquals(prepared.body.content.input, { md: "hello" });
});
