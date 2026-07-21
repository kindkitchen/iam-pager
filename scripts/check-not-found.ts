const probe_paths = [
  "/__iam_pager_not_found_smoke_test__",
  "/api/__iam_pager_not_found_smoke_test__",
  "/site/__iam_pager_not_found_smoke_test__",
] as const;

export type NotFoundFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Verifies the deployed global and wrapped-page 404 recovery links. */
export async function check_deployed_not_found_pages(
  base_url: string,
  fetch_response: NotFoundFetch = fetch,
): Promise<void> {
  const origin = deployment_origin(base_url);

  for (const path of probe_paths) {
    const url = new URL(path, origin);
    const response = await fetch_response(url, {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    const body = await response.text();

    if (response.status !== 404) {
      throw new Error(`${path}: expected 404, received ${response.status}`);
    }
    if (!response.headers.get("content-type")?.includes("text/html")) {
      throw new Error(`${path}: expected an HTML response`);
    }
    if (!/href=["']\/site["'][^>]*>\s*Go home\s*<\/a>/i.test(body)) {
      throw new Error(`${path}: missing the Go home link to /site`);
    }
  }
}

function deployment_origin(base_url: string): URL {
  const url = new URL(base_url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("deployment URL must use HTTP or HTTPS");
  }
  return new URL("/", url);
}

if (import.meta.main) {
  const base_url = Deno.args[0];
  if (base_url === undefined) {
    console.error("Usage: deno task smoke:not-found https://example.com");
    Deno.exit(2);
  }

  await check_deployed_not_found_pages(base_url);
  console.log(`Not-found home links verified at ${new URL(base_url).origin}`);
}
