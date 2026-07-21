import { assertEquals } from "@std/assert";
import { BrowserNotFoundResponsePolicy } from "./not-found-response.ts";

const policy = new BrowserNotFoundResponsePolicy();

Deno.test("browser not-found policy renders direct 404 responses for HTML navigation", () => {
  const request = new Request("https://pager.test/missing", {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  assertEquals(
    policy.should_render_page(
      request,
      new Response("page not found", {
        status: 404,
      }),
    ),
    true,
  );
});

Deno.test("browser not-found policy preserves direct delivery protocol responses", () => {
  for (
    const [accept, status] of [
      ["*/*", 404],
      ["application/json", 404],
      [null, 404],
      ["text/html", 200],
    ] as const
  ) {
    const headers = accept === null ? undefined : { accept };
    const request = new Request("https://pager.test/missing", { headers });
    assertEquals(
      policy.should_render_page(request, new Response("result", { status })),
      false,
    );
  }
});
