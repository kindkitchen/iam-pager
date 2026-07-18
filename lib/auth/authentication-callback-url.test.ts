import { assertEquals } from "@std/assert";
import {
  ConfiguredAuthenticationCallbackUrlResolver,
  RequestOriginAuthenticationCallbackUrlResolver,
} from "./authentication-callback-url.ts";

Deno.test("request-origin callback resolver builds the strategy endpoint with URL", () => {
  const resolver = new RequestOriginAuthenticationCallbackUrlResolver();

  assertEquals(
    resolver.resolve(
      new Request("https://app.example/auth/google/start?return_to=%2Fsite"),
      "google",
    ),
    "https://app.example/auth/google/callback",
  );
});

Deno.test("configured callback resolver preserves static production behavior without a host pattern", () => {
  const resolver = new ConfiguredAuthenticationCallbackUrlResolver({
    configured_callback_url: "https://production.example/auth/google/callback",
  });

  assertEquals(
    resolver.resolve(
      new Request("https://untrusted.example/auth/google/start"),
      "google",
    ),
    "https://production.example/auth/google/callback",
  );
});

Deno.test("configured callback resolver accepts only full HTTPS request-host matches", () => {
  const resolver = new ConfiguredAuthenticationCallbackUrlResolver({
    request_host_pattern: "preview-[a-z0-9-]+\\.example\\.com",
  });

  assertEquals(
    resolver.resolve(
      new Request("https://preview-change-42.example.com/auth/google/start"),
      "google",
    ),
    "https://preview-change-42.example.com/auth/google/callback",
  );
  for (
    const request_url of [
      "https://preview-change-42.example.com.attacker.test/auth/google/start",
      "https://attacker-preview-change-42.example.com/auth/google/start",
      "http://preview-change-42.example.com/auth/google/start",
      "https://preview-change-42.example.com:8443/auth/google/start",
    ]
  ) {
    assertEquals(
      resolver.resolve(new Request(request_url), "google"),
      null,
    );
  }
});
