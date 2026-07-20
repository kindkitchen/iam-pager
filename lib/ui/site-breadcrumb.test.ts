import { assertEquals } from "@std/assert";
import { site_breadcrumb_presenter } from "./site-breadcrumb.ts";

Deno.test("home trail is a single current step with no link", () => {
  assertEquals(site_breadcrumb_presenter.present({ kind: "home" }), {
    steps: [{ label: "Home" }],
  });
});

Deno.test("manage trail links home and marks manage as current", () => {
  assertEquals(site_breadcrumb_presenter.present({ kind: "manage" }), {
    steps: [{ label: "Home", href: "/site" }, { label: "Manage pages" }],
  });
});

Deno.test("public page trail links home and shows the title as current", () => {
  assertEquals(
    site_breadcrumb_presenter.present({ kind: "public_page", title: "notes" }),
    { steps: [{ label: "Home", href: "/site" }, { label: "notes" }] },
  );
});
