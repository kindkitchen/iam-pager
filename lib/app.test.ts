import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  GOOGLE_AUTH_MOCK_CONSENT_URL_ENV,
  GOOGLE_AUTH_MODE_ENV,
  GOOGLE_AUTH_REDIRECT_URI_ENV,
} from "./auth/mod.ts";
import {
  type AppServices,
  create_app_services,
  create_configured_app_services,
  parse_session_cookie_mode,
  SESSION_COOKIE_MODE_ENV,
} from "./app.ts";
import type { AppRequestState } from "./request-context.ts";
import { deliver_locator_path } from "./publishing/mod.ts";

Deno.test("composition root publishes and delivers an md page end to end", async () => {
  const { engine, publishing } = create_app_services();
  const published = await publishing.publish({
    locator: { namespace: "Guest", page_name: "hello" },
    content_type: "md-page",
    input: { md: "# Hi there" },
  });
  assertEquals(published.ok, true);
  if (!published.ok) return;
  assertEquals(published.path, "/Guest/hello");

  const response = await deliver_locator_path(
    engine,
    publishing,
    published.path,
  );
  assertEquals(response.status, 200);
  const body = await response.text();
  assertEquals(body.includes("Hi there"), true);
});

Deno.test("composition root forbids platform route namespaces", async () => {
  const { publishing } = create_app_services();
  for (const namespace of ["site", "API", "Auth"]) {
    const result = await publishing.publish({
      locator: { namespace },
      content_type: "md-page",
      input: { md: "x" },
    });
    assertEquals(result, { ok: false, reason: "forbidden_namespace" });
  }
});

Deno.test("composition root wires interface-backed identity services", async () => {
  const services = create_app_services();
  assertEquals(services.authentication_strategies.resolve("google"), null);

  const identity = await services.identity_repository.find_or_create({
    strategy_id: "fake",
    provider_subject: "subject-1",
    email: "person@example.com",
    observed_at: new Date("2026-07-18T12:00:00.000Z"),
  });
  assertEquals(identity.created, true);
  assertEquals(identity.identity.user_id, identity.user.user_id);
});

Deno.test("configured composition registers the selected Google strategy", async () => {
  const values: Readonly<Record<string, string>> = {
    [SESSION_COOKIE_MODE_ENV]: "local",
    [GOOGLE_AUTH_MODE_ENV]: "local",
    [GOOGLE_AUTH_REDIRECT_URI_ENV]:
      "http://localhost:5173/auth/google/callback",
    [GOOGLE_AUTH_MOCK_CONSENT_URL_ENV]:
      "http://localhost:5173/auth/google/mock-consent",
  };
  const services = await create_configured_app_services({
    get: (name) => values[name],
  });

  assertEquals(
    services.authentication_strategies.resolve("google")?.strategy_id,
    "google",
  );
  assertEquals(services.authentication_strategies.resolve("unknown"), null);
});

Deno.test("configured local Google browser flow renders consent and upgrades the session", async () => {
  const values: Readonly<Record<string, string>> = {
    [SESSION_COOKIE_MODE_ENV]: "local",
    [GOOGLE_AUTH_MODE_ENV]: "local",
    [GOOGLE_AUTH_REDIRECT_URI_ENV]:
      "http://localhost:5173/auth/google/callback",
    [GOOGLE_AUTH_MOCK_CONSENT_URL_ENV]:
      "http://localhost:5173/auth/google/mock-consent",
  };
  const services = await create_configured_app_services({
    get: (name) => values[name],
  });

  const start_request = new Request(
    "http://localhost:5173/auth/google/start?return_to=%2Fsite%2Faccount",
  );
  const started = await run_application_request(
    services,
    start_request,
    async (state) =>
      (await services.authentication_http.start(
        start_request,
        "google",
        state.request_context,
      )).response,
  );
  assertEquals(started.response.status, 303);
  assertEquals(started.state.request_context.session.kind, "guest");
  const original_session_id = started.state.request_context.session.session_id;
  const guest_cookie = response_cookie_header(started.response);
  const consent_location = started.response.headers.get("location");
  assertExists(consent_location);

  const consent_request = new Request(consent_location, {
    headers: { cookie: guest_cookie },
  });
  const consent = await run_application_request(
    services,
    consent_request,
    () => services.google_mock_consent_http.handle(consent_request),
  );
  assertEquals(consent.response.status, 200);
  assertEquals(
    consent.state.request_context.session.session_id,
    original_session_id,
  );
  const consent_html = await consent.response.text();
  assertStringIncludes(consent_html, "Mocked Google Consent Screen");
  const callback_url = matched_html_value(
    consent_html,
    /<form id="consent-form" method="GET" action="([^"]+)">/,
  );
  const state = matched_html_value(
    consent_html,
    /<input\s+id="state-input"[\s\S]*?value="([^"]+)"/,
  );
  const code = decode_package_html(matched_html_value(
    consent_html,
    /<textarea name="code" id="code-json"[^>]*>([\s\S]*?)<\/textarea>/,
  ));
  assertEquals(state, new URL(consent_location).searchParams.get("state"));

  const callback_request = new Request(
    `${decode_package_html(callback_url)}?${new URLSearchParams({
      code,
      state,
    })}`,
    { headers: { cookie: guest_cookie } },
  );
  const callback = await run_application_request(
    services,
    callback_request,
    async (request_state) => {
      const result = await services.authentication_http.callback(
        callback_request,
        "google",
        request_state.request_context,
      );
      if (result.session_resolution !== undefined) {
        services.request_context.apply_session_resolution(
          request_state,
          result.session_resolution,
        );
      }
      return result.response;
    },
  );
  assertEquals(callback.response.status, 303);
  assertEquals(callback.response.headers.get("location"), "/site/account");
  assertEquals(callback.state.request_context.session.kind, "authenticated");
  assertEquals(
    callback.state.request_context.session.session_id,
    original_session_id,
  );
  const authenticated_cookie = response_cookie_header(callback.response);
  assertEquals(authenticated_cookie === guest_cookie, false);

  const authenticated_request = new Request("http://localhost:5173/", {
    headers: { cookie: authenticated_cookie },
  });
  const authenticated = await run_application_request(
    services,
    authenticated_request,
    () => new Response(null, { status: 204 }),
  );
  assertEquals(
    authenticated.state.request_context.session.kind,
    "authenticated",
  );
  assertEquals(
    authenticated.state.request_context.session.session_id,
    original_session_id,
  );

  const stale_request = new Request("http://localhost:5173/", {
    headers: { cookie: guest_cookie },
  });
  const stale = await run_application_request(
    services,
    stale_request,
    () => new Response(null, { status: 204 }),
  );
  assertEquals(stale.state.request_context.session.kind, "guest");
  assertEquals(
    stale.state.request_context.session.session_id === original_session_id,
    false,
  );
});

Deno.test("composition root defaults secure and requires explicit local cookies", () => {
  const credential = {
    value: "A".repeat(43),
    expires_at: new Date("2026-07-24T12:00:00.000Z"),
  };
  const production_cookie = create_app_services().session_transport.attach(
    new Response(null),
    credential,
  ).headers.getSetCookie()[0];
  const local_cookie = create_app_services({ session_cookie_mode: "local" })
    .session_transport.attach(new Response(null), credential)
    .headers.getSetCookie()[0];

  assertEquals(production_cookie.includes("__Host-iam_pager_session="), true);
  assertEquals(production_cookie.includes("Secure"), true);
  assertEquals(local_cookie.includes("iam_pager_session_local="), true);
  assertEquals(local_cookie.includes("Secure"), false);
  assertEquals(parse_session_cookie_mode(undefined), "production");
  assertEquals(parse_session_cookie_mode("local"), "local");
  assertThrows(() => parse_session_cookie_mode("development"), TypeError);
});

async function run_application_request(
  services: AppServices,
  request: Request,
  route: (state: AppRequestState) => Response | Promise<Response>,
): Promise<{ response: Response; state: AppRequestState }> {
  const state = {} as AppRequestState;
  const response = await services.request_context.handle({
    req: request,
    state,
    next: async () => await route(state),
  });
  return { response, state };
}

function response_cookie_header(response: Response): string {
  const set_cookie = response.headers.getSetCookie()[0];
  assertExists(set_cookie);
  return set_cookie.split(";", 1)[0];
}

function matched_html_value(html: string, pattern: RegExp): string {
  const match = pattern.exec(html);
  assertExists(match);
  return match[1];
}

function decode_package_html(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
