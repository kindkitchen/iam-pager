import { assertEquals } from "@std/assert";
import { locator_key } from "./model.ts";

Deno.test("locator_key lowercases namespace and page name", () => {
  assertEquals(
    locator_key({ namespace: "MyNs", page_name: "My/Page" }),
    "myns/my/page",
  );
});

Deno.test("locator_key of a default page is the namespace alone", () => {
  assertEquals(locator_key({ namespace: "MyNs" }), "myns");
});

Deno.test("locator_key treats differently cased locators as identical", () => {
  const a = locator_key({ namespace: "Docs", page_name: "Intro" });
  const b = locator_key({ namespace: "docs", page_name: "intro" });
  assertEquals(a, b);
});
