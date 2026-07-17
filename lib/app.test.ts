import { assertEquals } from "@std/assert";
import { create_app_services } from "./app.ts";
import { deliver_locator_path } from "./publishing/mod.ts";

Deno.test("composition root publishes and delivers an md page end to end", async () => {
  const { engine, publishing } = create_app_services();
  const published = await publishing.publish({
    locator: { namespace: "Guest", page_name: "hello" },
    content_type: "md-page",
    input: { md: "# Hi there" },
  });
  assertEquals(published.ok, true);
  if (!published.ok) return;
  assertEquals(published.path, "/Guest/hello");

  const response = await deliver_locator_path(
    engine,
    publishing,
    published.path,
  );
  assertEquals(response.status, 200);
  const body = await response.text();
  assertEquals(body.includes("Hi there"), true);
});

Deno.test("composition root forbids the site and api namespaces", async () => {
  const { publishing } = create_app_services();
  for (const namespace of ["site", "API"]) {
    const result = await publishing.publish({
      locator: { namespace },
      content_type: "md-page",
      input: { md: "x" },
    });
    assertEquals(result, { ok: false, reason: "forbidden_namespace" });
  }
});
