import { assertEquals, assertThrows } from "@std/assert";
import {
  GOOGLE_AUTH_MOCK_CONSENT_URL_ENV,
  GOOGLE_AUTH_MODE_ENV,
  GOOGLE_AUTH_REDIRECT_URI_ENV,
} from "./auth/mod.ts";
import {
  create_app_services,
  create_configured_app_services,
  parse_session_cookie_mode,
  SESSION_COOKIE_MODE_ENV,
} from "./app.ts";
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
