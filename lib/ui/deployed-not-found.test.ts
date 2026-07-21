import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  check_deployed_not_found_pages,
  type NotFoundFetch,
} from "../../scripts/check-not-found.ts";

const home_link_page = `<!doctype html>
  <html><body><a class="not-found-secondary" href="/site">Go home</a></body></html>`;

Deno.test("deployed not-found smoke check covers global and wrapped page routes", async () => {
  const requested_paths: string[] = [];
  const fetch_response: NotFoundFetch = (input, init) => {
    const request_url = input instanceof Request
      ? new URL(input.url)
      : new URL(input.toString());
    requested_paths.push(request_url.pathname);
    assertEquals(init?.redirect, "manual");
    return Promise.resolve(
      new Response(home_link_page, {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
  };

  await check_deployed_not_found_pages(
    "https://pager.example/deployment/path",
    fetch_response,
  );

  assertEquals(requested_paths, [
    "/__iam_pager_not_found_smoke_test__",
    "/api/__iam_pager_not_found_smoke_test__",
    "/site/__iam_pager_not_found_smoke_test__",
  ]);
});

Deno.test("deployed not-found smoke check reports a missing home link", async () => {
  const error = await assertRejects(
    () =>
      check_deployed_not_found_pages(
        "https://pager.example",
        () =>
          Promise.resolve(
            new Response("<h1>Not found</h1>", {
              status: 404,
              headers: { "content-type": "text/html" },
            }),
          ),
      ),
    Error,
  );

  assertStringIncludes(error.message, "missing the Go home link to /site");
});
