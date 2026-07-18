import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  compose_google_gauth,
  compose_google_gauth_service,
  type EnvironmentSource,
  GOOGLE_AUTH_CLIENT_ID_ENV,
  GOOGLE_AUTH_CLIENT_SECRET_ENV,
  GOOGLE_AUTH_MOCK_CONSENT_URL_ENV,
  GOOGLE_AUTH_MODE_ENV,
  GOOGLE_AUTH_REDIRECT_URI_ENV,
  GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV,
  parse_google_auth_config,
} from "./google-gauth-composition.ts";
import { GoogleGAuthStrategy } from "./google-gauth-strategy.ts";

function environment(
  values: Readonly<Record<string, string>>,
): EnvironmentSource {
  return { get: (name) => values[name] };
}

Deno.test("Google auth configuration validates explicit local and original modes", () => {
  assertEquals(
    parse_google_auth_config(environment({
      [GOOGLE_AUTH_MODE_ENV]: "local",
      [GOOGLE_AUTH_REDIRECT_URI_ENV]:
        "http://localhost:5173/auth/google/callback",
      [GOOGLE_AUTH_MOCK_CONSENT_URL_ENV]:
        "http://localhost:5173/auth/google/mock-consent",
    })),
    {
      mode: "local",
      redirect_uri: "http://localhost:5173/auth/google/callback",
      mocked_google_consent_screen_url:
        "http://localhost:5173/auth/google/mock-consent",
    },
  );
  assertEquals(
    parse_google_auth_config(environment({
      [GOOGLE_AUTH_MODE_ENV]: "original",
      [GOOGLE_AUTH_REDIRECT_URI_ENV]:
        "https://pager.example/auth/google/callback",
      [GOOGLE_AUTH_CLIENT_ID_ENV]: "test-client-id",
      [GOOGLE_AUTH_CLIENT_SECRET_ENV]: "not-a-real-secret",
      [GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV]: "",
    })),
    {
      mode: "original",
      redirect_uri: "https://pager.example/auth/google/callback",
      client_id: "test-client-id",
      client_secret: "not-a-real-secret",
    },
  );
  assertEquals(
    parse_google_auth_config(environment({
      [GOOGLE_AUTH_MODE_ENV]: "original",
      [GOOGLE_AUTH_REDIRECT_URI_ENV]:
        "https://pager.example/auth/google/callback",
      [GOOGLE_AUTH_CLIENT_ID_ENV]: "test-client-id",
      [GOOGLE_AUTH_CLIENT_SECRET_ENV]: "not-a-real-secret",
      [GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV]:
        "pager-pr-[a-z0-9-]+\\.example\\.com",
    })),
    {
      mode: "original",
      redirect_uri: "https://pager.example/auth/google/callback",
      client_id: "test-client-id",
      client_secret: "not-a-real-secret",
      request_host_pattern: "pager-pr-[a-z0-9-]+\\.example\\.com",
    },
  );

  assertThrows(
    () => parse_google_auth_config(environment({})),
    TypeError,
    GOOGLE_AUTH_MODE_ENV,
  );
  assertThrows(
    () =>
      parse_google_auth_config(environment({
        [GOOGLE_AUTH_MODE_ENV]: "disabled",
      })),
    TypeError,
    "must be local or original",
  );
  assertThrows(
    () =>
      parse_google_auth_config(environment({
        [GOOGLE_AUTH_MODE_ENV]: "local",
        [GOOGLE_AUTH_REDIRECT_URI_ENV]:
          "https://deployed.example/auth/google/callback",
        [GOOGLE_AUTH_MOCK_CONSENT_URL_ENV]:
          "https://deployed.example/auth/google/mock-consent",
      })),
    TypeError,
    "loopback",
  );
  assertThrows(
    () =>
      parse_google_auth_config(environment({
        [GOOGLE_AUTH_MODE_ENV]: "original",
        [GOOGLE_AUTH_REDIRECT_URI_ENV]:
          "https://pager.example/auth/google/callback",
        [GOOGLE_AUTH_CLIENT_ID_ENV]: "test-client-id",
      })),
    TypeError,
    GOOGLE_AUTH_CLIENT_SECRET_ENV,
  );
  assertThrows(
    () =>
      parse_google_auth_config(environment({
        [GOOGLE_AUTH_MODE_ENV]: "original",
        [GOOGLE_AUTH_REDIRECT_URI_ENV]: "http://pager.example/wrong-callback",
        [GOOGLE_AUTH_CLIENT_ID_ENV]: "test-client-id",
        [GOOGLE_AUTH_CLIENT_SECRET_ENV]: "not-a-real-secret",
      })),
    TypeError,
    GOOGLE_AUTH_REDIRECT_URI_ENV,
  );
  assertThrows(
    () =>
      parse_google_auth_config(environment({
        [GOOGLE_AUTH_MODE_ENV]: "original",
        [GOOGLE_AUTH_REDIRECT_URI_ENV]:
          "https://pager.example/auth/google/callback",
        [GOOGLE_AUTH_CLIENT_ID_ENV]: "test-client-id",
        [GOOGLE_AUTH_CLIENT_SECRET_ENV]: "not-a-real-secret",
        [GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV]: "[invalid",
      })),
    TypeError,
    GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV,
  );
  assertEquals(
    parse_google_auth_config(environment({
      [GOOGLE_AUTH_MODE_ENV]: "local",
      [GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV]:
        "pager-pr-[a-z0-9-]+\\.example\\.com",
      [GOOGLE_AUTH_REDIRECT_URI_ENV]:
        "http://localhost:5173/auth/google/callback",
    })),
    {
      mode: "local",
      request_host_pattern: "pager-pr-[a-z0-9-]+\\.example\\.com",
    },
  );
  assertEquals(
    parse_google_auth_config(environment({
      [GOOGLE_AUTH_MODE_ENV]: "local",
      [GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV]:
        "pager-pr-[a-z0-9-]+\\.example\\.com",
    })),
    {
      mode: "local",
      request_host_pattern: "pager-pr-[a-z0-9-]+\\.example\\.com",
    },
  );
});

Deno.test("local gauth composition selects the mock preset without network access", async () => {
  const composition = await compose_google_gauth({
    mode: "local",
    redirect_uri: "http://localhost:5173/auth/google/callback",
    mocked_google_consent_screen_url:
      "http://localhost:5173/auth/google/mock-consent",
  });
  const result = await new GoogleGAuthStrategy(composition.service).begin({
    state: "local-state",
    callback_url: "http://localhost:5173/auth/google/callback",
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  const authorization_url = new URL(result.value.authorization_url);
  assertEquals(
    `${authorization_url.origin}${authorization_url.pathname}`,
    "http://localhost:5173/auth/google/mock-consent",
  );
  assertEquals(authorization_url.searchParams.get("state"), "local-state");
  assertEquals(
    authorization_url.searchParams.get("redirect_uri"),
    "http://localhost:5173/auth/google/callback",
  );
  assertEquals(result.value.attempt_context, "fake-code-verifier");
  assertEquals(
    composition.mock_consent_screen?.callback_url,
    authorization_url.searchParams.get("redirect_uri"),
  );
  const consent_html = composition.mock_consent_screen?.render("local-state") ??
    "";
  assertEquals(consent_html.includes("Mocked Google Consent Screen"), true);
  assertEquals(consent_html.includes('value="local-state"'), true);
});

Deno.test("local gauth composition derives callback and consent URLs from an allowlisted preview host", async () => {
  const composition = await compose_google_gauth({
    mode: "local",
    request_host_pattern: "pager-pr-[a-z0-9-]+\\.example\\.com",
  });
  const strategy = new GoogleGAuthStrategy(
    composition.service,
    composition.service_resolver,
  );
  const callback_url =
    "https://pager-pr-change-42.example.com/auth/google/callback";
  const result = await strategy.begin({
    state: "preview-state",
    callback_url,
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  const authorization_url = new URL(result.value.authorization_url);
  assertEquals(
    `${authorization_url.origin}${authorization_url.pathname}`,
    "https://pager-pr-change-42.example.com/auth/google/mock-consent",
  );
  assertEquals(
    authorization_url.searchParams.get("redirect_uri"),
    callback_url,
  );
  assertEquals(
    composition.mock_consent_screen?.allows(
      authorization_url,
      callback_url,
    ),
    true,
  );
  assertEquals(
    composition.mock_consent_screen?.allows(
      new URL(result.value.authorization_url.replace(
        "pager-pr-change-42.example.com",
        "attacker.example",
      )),
      callback_url,
    ),
    false,
  );
  assertEquals(
    composition.mock_consent_screen?.render("preview-state", callback_url)
      .includes(callback_url),
    true,
  );
});

Deno.test("original gauth composition resolves an allowlisted dynamic callback service", async () => {
  const composition = await compose_google_gauth({
    mode: "original",
    redirect_uri: "https://pager.example/auth/google/callback",
    client_id: "test-client-id",
    client_secret: "not-a-real-secret",
    request_host_pattern: "pager-pr-[a-z0-9-]+\\.example\\.com",
  });
  const strategy = new GoogleGAuthStrategy(
    composition.service,
    composition.service_resolver,
  );
  const result = await strategy.begin({
    state: "preview-state",
    callback_url: "https://pager-pr-change-42.example.com/auth/google/callback",
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(
    new URL(result.value.authorization_url).searchParams.get("redirect_uri"),
    "https://pager-pr-change-42.example.com/auth/google/callback",
  );
  await assertRejects(
    () =>
      composition.service_resolver.resolve(
        "https://pager-pr-change-42.example.com.attacker.test/auth/google/callback",
      ),
    TypeError,
  );
});

Deno.test("original gauth composition creates a Google authorization request without network or real credentials", async () => {
  const service = await compose_google_gauth_service({
    mode: "original",
    redirect_uri: "https://pager.example/auth/google/callback",
    client_id: "test-client-id",
    client_secret: "not-a-real-secret",
  });
  const result = await new GoogleGAuthStrategy(service).begin({
    state: "original-state",
    callback_url: "https://pager.example/auth/google/callback",
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  const authorization_url = new URL(result.value.authorization_url);
  assertEquals(authorization_url.origin, "https://accounts.google.com");
  assertEquals(
    authorization_url.searchParams.get("client_id"),
    "test-client-id",
  );
  assertEquals(authorization_url.searchParams.get("state"), "original-state");
  assertEquals(
    authorization_url.searchParams.get("redirect_uri"),
    "https://pager.example/auth/google/callback",
  );
  assertEquals(result.value.attempt_context.length > 0, true);
});
