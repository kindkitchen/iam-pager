import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { ManageApiKeysPage } from "../../components/ManageApiKeysPage.tsx";
import ApiKeyPanel from "../../islands/ApiKeyPanel.tsx";
import type { ApiKeyPanelKey } from "./api-key-panel.ts";
import { site_breadcrumb_presenter } from "./site-breadcrumb.ts";
import type { SiteNavigation } from "./site-navigation.ts";

const csrf_token = "c".repeat(43);

const keys: readonly ApiKeyPanelKey[] = [
  {
    api_key_id: "key-1",
    label: "ci deployment",
    permissions: ["read", "write"],
    status: "active",
    expires_at: null,
    created_at: "2026-07-22T12:00:00.000Z",
    revision: 2,
    etag: '"api-key-key-1-r2"',
  },
  {
    api_key_id: "key-2",
    label: "old key",
    permissions: ["read"],
    status: "expired",
    expires_at: "2026-08-01T00:00:00.000Z",
    created_at: "2026-07-01T12:00:00.000Z",
    revision: 1,
    etag: '"api-key-key-2-r1"',
  },
];

const navigation: SiteNavigation = {
  destinations: [
    { href: "/site", label: "Home", current: false },
    { href: "/site/api-keys", label: "API keys", current: true },
  ],
  session_label: "Signed in",
  action: {
    kind: "form",
    action: "/auth/logout",
    method: "post",
    fields: [{ name: "csrf_token", value: csrf_token }],
    label: "Sign out",
  },
};

Deno.test("API-key panel renders complete rows without secret material", () => {
  const html = render_to_string(
    <ApiKeyPanel csrf_token={csrf_token} initial_api_keys={keys} />,
  );
  assertStringIncludes(html, "ci deployment");
  assertStringIncludes(html, "read, write");
  assertStringIncludes(html, "expired");
  assertStringIncludes(html, "never expires");
  assertStringIncludes(html, "expires 2026-08-01");
  assertStringIncludes(html, "Generate key");
  assertStringIncludes(html, "Revoke all keys");
  assertStringIncludes(html, "Full access");
  assert(!html.includes("iamp_"));
  assert(!html.includes("secret"));
});

Deno.test("API-key panel renders the empty state without revoke-all", () => {
  const html = render_to_string(
    <ApiKeyPanel csrf_token={csrf_token} initial_api_keys={[]} />,
  );
  assertStringIncludes(html, "No API keys yet");
  assertStringIncludes(html, "Generate key");
  assertEquals(html.includes("Revoke all keys"), false);
});

Deno.test("manage page renders the creator panel from its model", () => {
  const html = render_to_string(
    <ManageApiKeysPage
      navigation={navigation}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "api_keys" })}
      api_key_panel={{ kind: "creator", csrf_token, api_keys: keys }}
    />,
  );
  assertStringIncludes(html, "<h1>API keys</h1>");
  assertStringIncludes(html, "ci deployment");
  assertEquals(html.includes("Sign in to manage API keys"), false);
});

Deno.test("manage page renders a guest fallback for the hidden panel", () => {
  const html = render_to_string(
    <ManageApiKeysPage
      navigation={{
        ...navigation,
        session_label: "Guest session",
        action: {
          kind: "link",
          href: "/auth/google/start?return_to=%2Fsite%2Fapi-keys",
          label: "Sign in with Google",
        },
      }}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "api_keys" })}
      api_key_panel={{ kind: "hidden" }}
    />,
  );
  assertStringIncludes(html, "Sign in to manage API keys");
  assertEquals(html.includes("Generate key"), false);
});
