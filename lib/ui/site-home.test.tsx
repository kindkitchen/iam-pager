import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { SiteHome } from "../../components/SiteHome.tsx";
import type { Session } from "../session/model.ts";
import { site_home_presenter } from "./site-home.ts";
import { site_breadcrumb_presenter } from "./site-breadcrumb.ts";
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

Deno.test("guest hub offers publishing, exploring, learning, and the invitation", () => {
  const home = site_home_presenter.present(guest_session);
  assertEquals(
    home.sections.map((section) => section.group),
    ["create", "discover", "learn", "account"],
  );
  const entries = home.sections.flatMap((section) =>
    section.entries.map((entry) => entry.id)
  );
  assertEquals(entries, [
    "publish",
    "explore",
    "demo",
    "about",
    "agent_skill",
    "invite",
  ]);
  assertEquals(entries.includes("manage"), false);
  assertEquals(entries.includes("api_keys"), false);
});

Deno.test("creator hub replaces the invitation with management destinations", () => {
  const entries = site_home_presenter.present(creator_session).sections
    .flatMap((section) => section.entries.map((entry) => entry.id));
  assertEquals(entries, [
    "publish",
    "manage",
    "explore",
    "demo",
    "about",
    "agent_skill",
    "api_keys",
  ]);
});

Deno.test("home renders hub cards and no publishing form", () => {
  const url = new URL("https://app.example/");
  const html = render_to_string(
    <SiteHome
      navigation={site_navigation_presenter.present(guest_session, url)}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "home" })}
      home={site_home_presenter.present(guest_session)}
    />,
  );
  assertStringIncludes(html, 'href="/site/publish"');
  assertStringIncludes(html, 'href="/site/demo"');
  assertStringIncludes(html, 'href="/site/about"');
  assertStringIncludes(html, 'href="/site/invite"');
  assertStringIncludes(html, "site-hub-card");
  assertEquals(html.includes("publish-form"), false);
  assertEquals(html.includes("page-management-panel"), false);
});
