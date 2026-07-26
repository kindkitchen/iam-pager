import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { SiteEditorialView } from "../../components/SiteEditorial.tsx";
import type { Session } from "../session/model.ts";
import { site_breadcrumb_presenter } from "./site-breadcrumb.ts";
import { site_editorial_presenter } from "./site-editorial.ts";
import { site_navigation_presenter } from "./site-navigation.ts";

const guest_session: Session = {
  kind: "guest",
  session_id: "session-1",
  session_version: 1,
  created_at: new Date("2026-07-18T12:00:00.000Z"),
  last_seen_at: new Date("2026-07-18T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-07-25T12:00:00.000Z"),
};

const creator_session: Session = {
  ...guest_session,
  kind: "authenticated",
  user_id: "user-private-id",
  authenticated_at: new Date("2026-07-18T12:01:00.000Z"),
  idle_expires_at: new Date("2026-08-17T12:01:00.000Z"),
  csrf_token: "c".repeat(43),
};

Deno.test("editorial topics carry sections and at least one next step", () => {
  for (const topic of ["about", "demo", "invite"] as const) {
    const page = site_editorial_presenter.present(topic, guest_session);
    assertEquals(page.topic, topic);
    assertEquals(page.sections.length > 0, true);
    assertEquals(page.actions.length > 0, true);
  }
});

Deno.test("invitation differs for guests and signed-in creators", () => {
  const guest = site_editorial_presenter.present("invite", guest_session);
  const creator = site_editorial_presenter.present("invite", creator_session);
  assertStringIncludes(guest.title, "Keep the paths");
  assertStringIncludes(creator.title, "already have a creator account");
});

Deno.test("editorial view renders body, example, and actions", () => {
  const url = new URL("https://app.example/site/demo");
  const html = render_to_string(
    <SiteEditorialView
      navigation={site_navigation_presenter.present(guest_session, url)}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "demo" })}
      editorial={site_editorial_presenter.present("demo", guest_session)}
    />,
  );
  assertStringIncludes(html, "From an empty path to a shared URL");
  assertStringIncludes(html, "<code>");
  assertStringIncludes(html, "site-editorial-action-primary");
  assertStringIncludes(html, 'href="/site/publish"');
});
