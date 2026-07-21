import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { SiteSessionNavigation } from "../../components/SiteApp.tsx";
import type { Session } from "../session/model.ts";
import {
  SessionSiteNavigationPresenter,
  type SiteNavigation,
} from "./site-navigation.ts";

const guest_session: Session = {
  kind: "guest",
  session_id: "session-1",
  session_version: 1,
  created_at: new Date("2026-07-18T12:00:00.000Z"),
  last_seen_at: new Date("2026-07-18T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-07-25T12:00:00.000Z"),
};

const authenticated_session: Session = {
  ...guest_session,
  kind: "authenticated",
  user_id: "user-private-id",
  authenticated_at: new Date("2026-07-18T12:01:00.000Z"),
  idle_expires_at: new Date("2026-08-17T12:01:00.000Z"),
  csrf_token: "c".repeat(43),
};

Deno.test("site navigation offers guests Google sign-in with a safe local return", () => {
  const presenter = new SessionSiteNavigationPresenter();
  assertEquals(
    presenter.present(
      guest_session,
      new URL("https://app.example/site/drafts?filter=mine&q=a%2Bb"),
    ),
    {
      destinations: [
        { href: "/site", label: "Home", current: false },
        { href: "/site/explore", label: "Explore", current: false },
      ],
      session_label: "Guest session",
      action: {
        kind: "link",
        href:
          "/auth/google/start?return_to=%2Fsite%2Fdrafts%3Ffilter%3Dmine%26q%3Da%252Bb",
        label: "Sign in with Google",
      },
    },
  );

  const unsafe = presenter.present(
    guest_session,
    new URL("https://app.example//attacker.example"),
  );
  assertEquals(unsafe.action.kind, "link");
  if (unsafe.action.kind === "link") {
    assertEquals(unsafe.action.href, "/auth/google/start?return_to=%2F");
  }
});

Deno.test("site navigation exposes only the trusted logout form for authenticated sessions", () => {
  const navigation = new SessionSiteNavigationPresenter().present(
    authenticated_session,
    new URL("https://app.example/site/account?ignored=true"),
  );

  assertEquals(navigation, {
    destinations: [
      { href: "/site", label: "Home", current: false },
      { href: "/site/explore", label: "Explore", current: false },
      { href: "/site/manage", label: "Manage", current: false },
    ],
    session_label: "Signed in",
    action: {
      kind: "form",
      action: "/auth/logout",
      method: "post",
      fields: [{
        name: "csrf_token",
        value: authenticated_session.csrf_token,
      }],
      label: "Sign out",
    },
  });
  assertEquals(JSON.stringify(navigation).includes("user-private-id"), false);
  assertEquals(JSON.stringify(navigation).includes("ignored"), false);
});

Deno.test("site session navigation renders link and protected form models", () => {
  const guest_navigation: SiteNavigation = {
    destinations: [
      { href: "/site", label: "Home", current: true },
      { href: "/site/explore", label: "Explore", current: false },
    ],
    session_label: "Guest session",
    action: {
      kind: "link",
      href: "/auth/google/start?return_to=%2F",
      label: "Sign in with Google",
    },
  };
  const guest_html = render_to_string(
    <SiteSessionNavigation navigation={guest_navigation} />,
  );
  assertStringIncludes(guest_html, "Guest session");
  assertStringIncludes(guest_html, 'href="/site/explore"');
  assertStringIncludes(guest_html, 'aria-current="page"');
  assertStringIncludes(
    guest_html,
    'href="/auth/google/start?return_to=%2F"',
  );
  assertEquals(guest_html.includes("csrf_token"), false);

  const authenticated_navigation = new SessionSiteNavigationPresenter().present(
    authenticated_session,
    new URL("https://app.example/"),
  );
  const authenticated_html = render_to_string(
    <SiteSessionNavigation navigation={authenticated_navigation} />,
  );
  assertStringIncludes(authenticated_html, "Signed in");
  assertStringIncludes(authenticated_html, 'method="post"');
  assertStringIncludes(authenticated_html, 'action="/auth/logout"');
  assertStringIncludes(authenticated_html, 'name="csrf_token"');
  assertStringIncludes(authenticated_html, authenticated_session.csrf_token);
  assertEquals(authenticated_html.includes("Sign in with Google"), false);
});
