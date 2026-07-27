import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { PublishPage } from "../../components/PublishPage.tsx";
import type { Session } from "../session/model.ts";
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

const url = new URL("https://app.example/site/publish");

function render(session: Session, creator: boolean): string {
  return render_to_string(
    <PublishPage
      navigation={site_navigation_presenter.present(session, url)}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "publish" })}
      namespace_panel={creator
        ? {
          kind: "creator",
          csrf_token: "c".repeat(43),
          reservations: [{
            namespace: "Mine",
            path: "/Mine",
            reserved_at: "2026-07-18T12:02:00.000Z",
          }],
        }
        : { kind: "hidden" }}
      storage_connections={{ kind: "guest" }}
    />,
  );
}

Deno.test("guests see the unprotected-page notice on the publish route", () => {
  const html = render(guest_session, false);
  assertStringIncludes(html, "Guest pages are unprotected");
  assertStringIncludes(html, 'href="/site/invite"');
});

Deno.test("creators publish without any unprotected-page notice", () => {
  const html = render(creator_session, true);
  assertEquals(html.includes("guest-notice"), false);
  assertEquals(html.includes("unprotected"), false);
  assertEquals(html.includes("Unreserved pages"), false);
  assertStringIncludes(html, "Creator publishing");
  assertStringIncludes(html, "namespace you own");
});
