import { assertEquals, assertStringIncludes } from "@std/assert";
import type { GoogleMockConsentScreen } from "./google-gauth-composition.ts";
import { GoogleMockConsentHttpAdapter } from "./google-mock-consent-http.ts";

const callback_url = "http://localhost:5173/auth/google/callback";
const valid_state = "s".repeat(43);

class FakeGoogleMockConsentScreen implements GoogleMockConsentScreen {
  readonly callback_url = callback_url;
  readonly states: string[] = [];

  render(state: string): string {
    this.states.push(state);
    return `<html>package screen for ${state}</html>`;
  }
}

function consent_url(overrides: Readonly<Record<string, string>> = {}): string {
  const query = new URLSearchParams({
    state: valid_state,
    scope: "openid email profile",
    redirect_uri: callback_url,
    ...overrides,
  });
  return `http://localhost:5173/auth/google/mock-consent?${query}`;
}

Deno.test("local Google mock consent serves the configured package renderer", async () => {
  const screen = new FakeGoogleMockConsentScreen();
  const handler = new GoogleMockConsentHttpAdapter({ screen });

  const response = handler.handle(new Request(consent_url()));

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("referrer-policy"), "no-referrer");
  assertStringIncludes(
    response.headers.get("content-security-policy") ?? "",
    "form-action 'self'",
  );
  assertEquals(
    await response.text(),
    `<html>package screen for ${valid_state}</html>`,
  );
  assertEquals(screen.states, [valid_state]);
});

Deno.test("local Google mock consent rejects altered authorization queries", () => {
  const screen = new FakeGoogleMockConsentScreen();
  const handler = new GoogleMockConsentHttpAdapter({ screen });
  const requests = [
    consent_url({ state: "short" }),
    consent_url({ scope: "openid email" }),
    consent_url({ redirect_uri: "http://localhost:5173/other" }),
    `${consent_url()}&state=${valid_state}`,
    `${consent_url()}&extra=value`,
  ];

  assertEquals(
    requests.map((url) => handler.handle(new Request(url)).status),
    [400, 400, 400, 400, 400],
  );
  assertEquals(screen.states, []);
});

Deno.test("Google mock consent stays unavailable outside local mode", () => {
  const unavailable = new GoogleMockConsentHttpAdapter({ screen: null });
  const screen = new FakeGoogleMockConsentScreen();
  const available = new GoogleMockConsentHttpAdapter({ screen });

  assertEquals(unavailable.handle(new Request(consent_url())).status, 404);
  const wrong_method = available.handle(
    new Request(consent_url(), { method: "POST" }),
  );
  assertEquals(wrong_method.status, 405);
  assertEquals(wrong_method.headers.get("allow"), "GET");
  assertEquals(screen.states, []);
});
