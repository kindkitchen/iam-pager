import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import type { SessionLogoutManager } from "../session/interfaces.ts";
import type {
  AuthenticatedSession,
  Session,
  SessionLogoutResult,
} from "../session/model.ts";
import type { AuthenticationOrchestrator } from "./interfaces.ts";
import type {
  AuthenticationCallbackRequest,
  AuthenticationCallbackResult,
  AuthenticationStartRequest,
  AuthenticationStartResult,
} from "./model.ts";
import {
  AuthenticationHttpAdapter,
  type AuthenticationHttpFailure,
  type AuthenticationHttpLogger,
} from "./http.ts";

const now = new Date("2026-07-18T12:00:00.000Z");
const guest_session: Session = {
  kind: "guest",
  session_id: "session-1",
  session_version: 1,
  created_at: now,
  last_seen_at: now,
  absolute_expires_at: new Date("2026-07-25T12:00:00.000Z"),
};
const authenticated_session: AuthenticatedSession = {
  ...guest_session,
  kind: "authenticated",
  session_version: 3,
  user_id: "user-1",
  authenticated_at: now,
  idle_expires_at: new Date("2026-08-17T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-10-16T12:00:00.000Z"),
  csrf_token: "c".repeat(43),
};
const fresh_guest_session: Session = {
  ...guest_session,
  session_id: "session-2",
};

class FakeAuthentication implements AuthenticationOrchestrator {
  readonly start_inputs: AuthenticationStartRequest[] = [];
  readonly callback_inputs: AuthenticationCallbackRequest[] = [];
  start_result: AuthenticationStartResult = {
    ok: true,
    value: { authorization_url: "https://provider.example/authorize" },
  };
  callback_result: AuthenticationCallbackResult = {
    ok: true,
    value: {
      identity: {
        user: { user_id: "user-1", created_at: now },
        identity: {
          user_id: "user-1",
          strategy_id: "google",
          provider_subject: "provider-subject",
          email: "person@example.com",
          created_at: now,
          updated_at: now,
        },
        created: true,
      },
      session_resolution: {
        session: authenticated_session,
        credential_to_set: {
          value: "N".repeat(43),
          expires_at: authenticated_session.idle_expires_at,
        },
      },
      return_to: "/site/account?tab=security",
    },
  };
  throw_on_start = false;
  throw_on_callback = false;

  start(input: AuthenticationStartRequest): Promise<AuthenticationStartResult> {
    this.start_inputs.push(input);
    if (this.throw_on_start) throw new Error("secret provider start cause");
    return Promise.resolve(this.start_result);
  }

  complete(
    input: AuthenticationCallbackRequest,
  ): Promise<AuthenticationCallbackResult> {
    this.callback_inputs.push(input);
    if (this.throw_on_callback) {
      throw new Error("secret provider callback cause");
    }
    return Promise.resolve(this.callback_result);
  }
}

class FakeSessions implements SessionLogoutManager {
  readonly logout_inputs: Array<{ session: Session; csrf_token: string }> = [];
  logout_result: SessionLogoutResult = {
    ok: true,
    resolution: {
      session: fresh_guest_session,
      credential_to_set: {
        value: "G".repeat(43),
        expires_at: fresh_guest_session.absolute_expires_at,
      },
    },
  };
  throw_on_logout = false;

  logout(session: Session, csrf_token: string): Promise<SessionLogoutResult> {
    this.logout_inputs.push({ session, csrf_token });
    if (this.throw_on_logout) throw new Error("secret logout cause");
    return Promise.resolve(this.logout_result);
  }
}

class MemoryLogger implements AuthenticationHttpLogger {
  readonly events: AuthenticationHttpFailure[] = [];

  failure(event: AuthenticationHttpFailure): void {
    this.events.push(event);
  }
}

function make_fixture() {
  const authentication = new FakeAuthentication();
  const sessions = new FakeSessions();
  const logger = new MemoryLogger();
  const adapter = new AuthenticationHttpAdapter({
    authentication,
    sessions,
    logger,
  });
  const context = {
    request_id: "request-1",
    session: guest_session,
  };
  return { adapter, authentication, context, logger, sessions };
}

function state(character = "s"): string {
  return character.repeat(43);
}

Deno.test("authentication HTTP start builds an exact callback and redirects", async () => {
  const { adapter, authentication, context, logger } = make_fixture();
  authentication.start_result = {
    ok: true,
    value: {
      authorization_url: `https://provider.example/authorize?state=${state()}`,
    },
  };

  const result = await adapter.start(
    new Request(
      "https://app.example/auth/google/start?return_to=%2Fsite%2Faccount%3Ftab%3Dsecurity",
    ),
    "google",
    context,
  );

  assertEquals(result.response.status, 303);
  assertEquals(
    result.response.headers.get("location"),
    `https://provider.example/authorize?state=${state()}`,
  );
  assertEquals(result.response.headers.get("cache-control"), "no-store");
  assertEquals(result.response.headers.get("referrer-policy"), "no-referrer");
  assertEquals(authentication.start_inputs, [{
    session: guest_session,
    strategy_id: "google",
    callback_url: "https://app.example/auth/google/callback",
    return_to: "/site/account?tab=security",
  }]);
  assertEquals(logger.events, []);
});

Deno.test("authentication HTTP callback returns the rotated session for publication", async () => {
  const { adapter, authentication, context, logger } = make_fixture();
  const result = await adapter.callback(
    new Request(
      `https://app.example/auth/google/callback?code=provider-code&state=${state()}`,
    ),
    "google",
    context,
  );

  assertEquals(result.response.status, 303);
  assertEquals(
    result.response.headers.get("location"),
    "/site/account?tab=security",
  );
  assertEquals(authentication.callback_inputs, [{
    session: guest_session,
    strategy_id: "google",
    code: "provider-code",
    state: state(),
  }]);
  assertExists(result.session_resolution);
  assertEquals(result.session_resolution.session, authenticated_session);
  assertEquals(
    result.session_resolution.credential_to_set?.value,
    "N".repeat(43),
  );
  assertEquals(logger.events, []);
});

Deno.test("authentication HTTP callback burns recognizable state on invalid code", async () => {
  const { adapter, authentication, context, logger } = make_fixture();
  authentication.callback_result = { ok: false, reason: "invalid_callback" };

  const missing = await adapter.callback(
    new Request(
      `https://app.example/auth/google/callback?state=${state()}`,
    ),
    "google",
    context,
  );
  const oversized = await adapter.callback(
    new Request(
      `https://app.example/auth/google/callback?state=${state("t")}&code=${
        "x".repeat(4097)
      }`,
    ),
    "google",
    context,
  );

  assertEquals(missing.response.status, 400);
  assertEquals(oversized.response.status, 400);
  assertEquals(
    authentication.callback_inputs.map(({ code, state }) => ({ code, state })),
    [
      { code: "", state: state() },
      { code: "", state: state("t") },
    ],
  );
  assertEquals(
    logger.events.map((event) => event.category),
    ["callback_invalid_callback", "callback_invalid_callback"],
  );
});

Deno.test("authentication HTTP boundary rejects ambiguous queries before orchestration", async () => {
  const { adapter, authentication, context, logger } = make_fixture();

  const start_result = await adapter.start(
    new Request(
      "https://app.example/auth/google/start?return_to=%2Fone&return_to=%2Ftwo",
    ),
    "google",
    context,
  );
  const callback_result = await adapter.callback(
    new Request(
      `https://app.example/auth/google/callback?code=x&state=${state()}&state=${
        state("t")
      }`,
    ),
    "google",
    context,
  );

  assertEquals(start_result.response.status, 400);
  assertEquals(callback_result.response.status, 400);
  assertEquals(authentication.start_inputs, []);
  assertEquals(authentication.callback_inputs, []);
  assertEquals(
    logger.events.map((event) => event.category),
    ["start_invalid_query", "callback_invalid_query"],
  );
});

Deno.test("authentication HTTP logout publishes a fresh guest session", async () => {
  const { adapter, context, logger, sessions } = make_fixture();
  const result = await adapter.logout(
    new Request("https://app.example/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `csrf_token=${authenticated_session.csrf_token}`,
    }),
    { ...context, session: authenticated_session },
  );

  assertEquals(result.response.status, 303);
  assertEquals(result.response.headers.get("location"), "/");
  assertEquals(result.response.headers.get("cache-control"), "no-store");
  assertEquals(sessions.logout_inputs, [{
    session: authenticated_session,
    csrf_token: authenticated_session.csrf_token,
  }]);
  assertExists(result.session_resolution);
  assertEquals(result.session_resolution.session, fresh_guest_session);
  assertEquals(
    result.session_resolution.credential_to_set?.value,
    "G".repeat(43),
  );
  assertEquals(logger.events, []);
});

Deno.test("authentication HTTP logout rejects unsafe requests and hides CSRF data", async () => {
  const { adapter, context, logger, sessions } = make_fixture();
  const authenticated_context = { ...context, session: authenticated_session };

  const wrong_method = await adapter.logout(
    new Request("https://app.example/auth/logout"),
    authenticated_context,
  );
  const ambiguous = await adapter.logout(
    new Request("https://app.example/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `csrf_token=${authenticated_session.csrf_token}&csrf_token=secret`,
    }),
    authenticated_context,
  );
  sessions.logout_result = { ok: false, reason: "invalid_csrf" };
  const invalid_csrf = await adapter.logout(
    new Request("https://app.example/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "csrf_token=secret-submitted-token",
    }),
    authenticated_context,
  );

  assertEquals(wrong_method.response.status, 405);
  assertEquals(wrong_method.response.headers.get("allow"), "POST");
  assertEquals(ambiguous.response.status, 400);
  assertEquals(invalid_csrf.response.status, 403);
  assertEquals(sessions.logout_inputs.length, 1);
  assertEquals(JSON.stringify(logger.events).includes("secret"), false);
  assertEquals(
    logger.events.map((event) => event.category),
    [
      "logout_invalid_request",
      "logout_invalid_request",
      "logout_invalid_csrf",
    ],
  );
});

Deno.test("authentication HTTP failures use safe status, body, and diagnostics", async () => {
  const { adapter, authentication, context, logger } = make_fixture();
  authentication.start_result = { ok: false, reason: "unknown_strategy" };
  const unknown = await adapter.start(
    new Request("https://app.example/auth/missing/start"),
    "missing",
    context,
  );

  authentication.callback_result = { ok: false, reason: "provider_failure" };
  const provider_failure = await adapter.callback(
    new Request(
      `https://app.example/auth/google/callback?code=secret-code&state=${state()}`,
    ),
    "google",
    context,
  );

  authentication.throw_on_start = true;
  const internal = await adapter.start(
    new Request("https://app.example/auth/google/start"),
    "google",
    context,
  );

  assertEquals(unknown.response.status, 404);
  assertEquals(provider_failure.response.status, 502);
  assertEquals(internal.response.status, 500);
  assertStringIncludes(await provider_failure.response.text(), "could not");
  assertEquals(
    JSON.stringify(logger.events).includes("secret"),
    false,
  );
  assertEquals(logger.events, [
    {
      request_id: "request-1",
      strategy_id: "missing",
      category: "start_unknown_strategy",
    },
    {
      request_id: "request-1",
      strategy_id: "google",
      category: "callback_provider_failure",
    },
    {
      request_id: "request-1",
      strategy_id: "google",
      category: "start_internal_failure",
    },
  ]);
});
