import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  compose_google_drive_oauth,
  GOOGLE_DRIVE_CLIENT_ID_ENV,
  GOOGLE_DRIVE_CLIENT_SECRET_ENV,
  GOOGLE_DRIVE_MOCK_CONSENT_URL_ENV,
  GOOGLE_DRIVE_MODE_ENV,
  GOOGLE_DRIVE_REDIRECT_URI_ENV,
  GOOGLE_DRIVE_REQUEST_HOST_PATTERN_ENV,
  parse_google_drive_oauth_config,
} from "./google-drive-oauth-composition.ts";
import { google_drive_file_scope } from "./google-drive-oauth.ts";

function environment(values: Readonly<Record<string, string>>) {
  return { get: (name: string) => values[name] };
}

Deno.test("Google Drive OAuth configuration uses its own exact routes and credentials", () => {
  assertEquals(
    parse_google_drive_oauth_config(environment({
      [GOOGLE_DRIVE_MODE_ENV]: "local",
      [GOOGLE_DRIVE_REDIRECT_URI_ENV]:
        "http://localhost:5173/auth/storage/google-drive/callback",
      [GOOGLE_DRIVE_MOCK_CONSENT_URL_ENV]:
        "http://localhost:5173/auth/storage/google-drive/mock-consent",
    })),
    {
      mode: "local",
      redirect_uri: "http://localhost:5173/auth/storage/google-drive/callback",
      mocked_google_consent_screen_url:
        "http://localhost:5173/auth/storage/google-drive/mock-consent",
    },
  );
  assertEquals(
    parse_google_drive_oauth_config(environment({
      [GOOGLE_DRIVE_MODE_ENV]: "local",
      [GOOGLE_DRIVE_REQUEST_HOST_PATTERN_ENV]:
        "pager-pr-[a-z0-9-]+\\.example\\.com",
    })),
    {
      mode: "local",
      request_host_pattern: "pager-pr-[a-z0-9-]+\\.example\\.com",
    },
  );
  assertEquals(
    parse_google_drive_oauth_config(environment({
      [GOOGLE_DRIVE_MODE_ENV]: "original",
      [GOOGLE_DRIVE_REDIRECT_URI_ENV]:
        "https://pager.example/auth/storage/google-drive/callback",
      [GOOGLE_DRIVE_CLIENT_ID_ENV]: "drive-client",
      [GOOGLE_DRIVE_CLIENT_SECRET_ENV]: "drive-secret",
    })),
    {
      mode: "original",
      redirect_uri: "https://pager.example/auth/storage/google-drive/callback",
      client_id: "drive-client",
      client_secret: "drive-secret",
    },
  );
  assertThrows(
    () =>
      parse_google_drive_oauth_config(environment({
        [GOOGLE_DRIVE_MODE_ENV]: "local",
        [GOOGLE_DRIVE_REDIRECT_URI_ENV]:
          "http://localhost:5173/auth/google/callback",
        [GOOGLE_DRIVE_MOCK_CONSENT_URL_ENV]:
          "http://localhost:5173/auth/google/mock-consent",
      })),
    TypeError,
    GOOGLE_DRIVE_REDIRECT_URI_ENV,
  );
  assertThrows(
    () =>
      parse_google_drive_oauth_config(environment({
        [GOOGLE_DRIVE_MODE_ENV]: "local",
        [GOOGLE_DRIVE_REQUEST_HOST_PATTERN_ENV]: "[invalid",
      })),
    TypeError,
    GOOGLE_DRIVE_REQUEST_HOST_PATTERN_ENV,
  );
  assertThrows(
    () =>
      parse_google_drive_oauth_config(environment({
        [GOOGLE_DRIVE_MODE_ENV]: "original",
        [GOOGLE_DRIVE_REDIRECT_URI_ENV]:
          "https://pager.example/auth/storage/google-drive/callback",
      })),
    TypeError,
    `${GOOGLE_DRIVE_CLIENT_ID_ENV} must be a non-empty configured value when ${GOOGLE_DRIVE_MODE_ENV}=original`,
  );
});

Deno.test("dynamic local Drive composition accepts only allowlisted preview hosts", async () => {
  const composition = await compose_google_drive_oauth({
    mode: "local",
    request_host_pattern: "pager-pr-[a-z0-9-]+\\.example\\.com",
  });
  const callback_url =
    "https://pager-pr-change-42.example.com/auth/storage/google-drive/callback";
  const started = await composition.client.begin({
    state: "s".repeat(43),
    callback_url,
  });
  assert(started.ok);
  const consent_url = new URL(started.value.authorization_url);
  assertEquals(consent_url.origin, "https://pager-pr-change-42.example.com");
  assertEquals(
    composition.mock_consent_screen?.allows(
      consent_url,
      callback_url,
    ),
    true,
  );
  const rejected = await composition.client.begin({
    state: "s".repeat(43),
    callback_url:
      "https://pager-pr-change-42.example.com.attacker.test/auth/storage/google-drive/callback",
  });
  assertEquals(rejected, { ok: false, reason: "provider_failure" });
});

Deno.test("local Drive composition requests offline consent and drive.file", async () => {
  const composition = await compose_google_drive_oauth({
    mode: "local",
    redirect_uri: "http://localhost:5173/auth/storage/google-drive/callback",
    mocked_google_consent_screen_url:
      "http://localhost:5173/auth/storage/google-drive/mock-consent",
  });
  const started = await composition.client.begin({
    state: "s".repeat(43),
    callback_url: "http://localhost:5173/auth/storage/google-drive/callback",
  });
  assert(started.ok);
  const url = new URL(started.value.authorization_url);
  assertEquals(url.pathname, "/auth/storage/google-drive/mock-consent");
  assertEquals(
    url.searchParams.get("scope"),
    `openid email profile ${google_drive_file_scope}`,
  );
  assertEquals(url.searchParams.get("access_type"), "offline");
  assertEquals(url.searchParams.get("prompt"), "consent");
  assertEquals(
    composition.mock_consent_screen?.allows(
      url,
      url.searchParams.get("redirect_uri")!,
    ),
    true,
  );

  const completed = await composition.client.complete({
    code: JSON.stringify({
      refresh_token: "offline-refresh",
      user_info: { id: "drive-subject" },
    }),
    callback_url: "http://localhost:5173/auth/storage/google-drive/callback",
    attempt_context: started.value.attempt_context,
  });
  assert(completed.ok);
  assertEquals(completed.value.provider_subject, "drive-subject");
  assertEquals(completed.value.scopes, [google_drive_file_scope]);
  assertEquals(completed.value.credentials.refresh_token, "offline-refresh");
});

Deno.test("original Drive composition is distinct from sign-in registration", async () => {
  const composition = await compose_google_drive_oauth({
    mode: "original",
    redirect_uri: "https://pager.example/auth/storage/google-drive/callback",
    client_id: "drive-client-not-sign-in-client",
    client_secret: "not-a-real-secret",
  });
  const started = await composition.client.begin({
    state: "s".repeat(43),
    callback_url: "https://pager.example/auth/storage/google-drive/callback",
  });
  assert(started.ok);
  const url = new URL(started.value.authorization_url);
  assertEquals(
    url.searchParams.get("client_id"),
    "drive-client-not-sign-in-client",
  );
  assertEquals(
    url.searchParams.get("redirect_uri"),
    "https://pager.example/auth/storage/google-drive/callback",
  );
  assertEquals(
    url.searchParams.get("scope")?.includes(google_drive_file_scope),
    true,
  );
});
