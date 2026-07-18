import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import type {
  AppRequestState,
  RequestPipelineContext,
} from "./request-context.ts";
import { RequestContextMiddleware } from "./request-context.ts";
import {
  CookieSessionStrategy,
  type CredentialGenerator,
  type IdGenerator,
  MemorySessionRepository,
  session_cookie_config,
  type SessionResolution,
  SessionService,
  SystemClock,
} from "./session/mod.ts";

class SequenceGenerator implements IdGenerator, CredentialGenerator {
  constructor(private readonly values: string[]) {}

  generate(): string {
    const value = this.values.shift();
    if (value === undefined) throw new Error("sequence exhausted");
    return value;
  }
}

function make_fixture() {
  const session_transport = new CookieSessionStrategy(
    session_cookie_config("local"),
  );
  const session = new SessionService({
    repository: new MemorySessionRepository(),
    clock: new SystemClock(),
    id_generator: new SequenceGenerator([
      "session-1",
      "session-2",
      "session-3",
      "session-4",
      "session-5",
      "session-6",
    ]),
    credential_generator: new SequenceGenerator(
      "ABCDEF".split("").map((character) => character.repeat(43)),
    ),
  });
  const middleware = new RequestContextMiddleware({
    session_resolver: session,
    session_transport,
    request_id_generator: new SequenceGenerator([
      "request-1",
      "request-2",
      "request-3",
      "request-4",
      "request-5",
      "request-6",
    ]),
  });
  return { middleware, session_transport };
}

function pipeline_context(
  req: Request,
  next: (state: AppRequestState) => Promise<Response> | Response,
): RequestPipelineContext {
  const state = {} as AppRequestState;
  return {
    req,
    state,
    next: () => Promise.resolve(next(state)),
  };
}

Deno.test("request middleware creates and then resolves one logical browser session", async () => {
  const { middleware, session_transport } = make_fixture();
  let route_calls = 0;
  const first_context = pipeline_context(
    new Request("http://localhost/site", {
      headers: { "x-request-id": "caller-controlled" },
    }),
    (state) => {
      route_calls++;
      assertEquals(state.request_context.request_id, "request-1");
      assertEquals(state.request_context.session.kind, "guest");
      return new Response("created", { status: 201 });
    },
  );

  const first_response = await middleware.handle(first_context);
  assertEquals(route_calls, 1);
  assertEquals(first_response.headers.get("x-request-id"), "request-1");
  const set_cookie = first_response.headers.getSetCookie()[0];
  assertExists(set_cookie);
  const credential = session_transport.extract(
    new Request("http://localhost/site", {
      headers: { cookie: set_cookie.split(";", 1)[0] },
    }),
  );
  assertExists(credential);
  const first_session_id =
    first_context.state.request_context.session.session_id;

  const second_context = pipeline_context(
    new Request("http://localhost/api/pages", {
      headers: { cookie: `iam_pager_session_local=${credential}` },
    }),
    (state) => {
      route_calls++;
      assertEquals(
        state.request_context.session.session_id,
        first_session_id,
      );
      return Response.json({ ok: true });
    },
  );
  const second_response = await middleware.handle(second_context);

  assertEquals(route_calls, 2);
  assertEquals(second_response.headers.get("x-request-id"), "request-2");
  assertEquals(second_response.headers.getSetCookie(), []);
  assertNotEquals(
    first_response.headers.get("x-request-id"),
    second_response.headers.get("x-request-id"),
  );
});

Deno.test("request middleware preserves every returned response surface", async () => {
  const { middleware } = make_fixture();
  const direct_body = "<!doctype html><h1>creator content</h1>";
  const cases = [
    () => new Response("site", { status: 200, headers: { "x-kind": "site" } }),
    () =>
      new Response(null, {
        status: 303,
        headers: { location: "/after-auth", "x-kind": "redirect" },
      }),
    () =>
      Response.json({ error: "invalid" }, {
        status: 422,
        headers: { "cache-control": "no-store", "x-kind": "api-error" },
      }),
    () =>
      new Response(direct_body, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-length": String(
            new TextEncoder().encode(direct_body).byteLength,
          ),
          "content-security-policy": "sandbox; default-src 'none'",
          "content-disposition": "inline",
          "x-content-type-options": "nosniff",
          "x-kind": "direct",
          "x-request-id": "untrusted-route-value",
        },
      }),
  ];

  for (const [index, make_response] of cases.entries()) {
    let route_calls = 0;
    const original = make_response();
    const expected = {
      status: original.status,
      status_text: original.statusText,
      body: await original.clone().text(),
      headers: new Headers(original.headers),
    };
    const context = pipeline_context(
      new Request(`http://localhost/case-${index}`),
      () => {
        route_calls++;
        return original;
      },
    );

    const response = await middleware.handle(context);

    assertEquals(route_calls, 1);
    assertEquals(response.status, expected.status);
    assertEquals(response.statusText, expected.status_text);
    assertEquals(await response.text(), expected.body);
    for (const [name, value] of expected.headers) {
      if (name === "x-request-id") continue;
      assertEquals(response.headers.get(name), value);
    }
    assertEquals(response.headers.get("x-request-id"), `request-${index + 1}`);
    assertEquals(response.headers.getSetCookie().length, 1);
  }
});

Deno.test("route session transitions supersede initially staged credentials", async () => {
  const { middleware } = make_fixture();
  let replacement: SessionResolution | undefined;
  const context = pipeline_context(
    new Request("http://localhost/auth/google/callback"),
    (state) => {
      const guest = state.request_context.session;
      replacement = {
        session: {
          ...guest,
          kind: "authenticated",
          session_version: guest.session_version + 1,
          user_id: "user-1",
          authenticated_at: new Date("2026-07-18T12:00:00.000Z"),
          idle_expires_at: new Date("2026-08-17T12:00:00.000Z"),
        },
        credential_to_set: {
          value: "Z".repeat(43),
          expires_at: new Date("2026-08-17T12:00:00.000Z"),
        },
      };
      middleware.apply_session_resolution(state, replacement);
      return new Response(null, { status: 303, headers: { location: "/" } });
    },
  );

  const response = await middleware.handle(context);

  assertExists(replacement);
  assertEquals(context.state.request_context.session, replacement.session);
  assertEquals(response.headers.getSetCookie().length, 1);
  assertEquals(
    response.headers.getSetCookie()[0].includes("Z".repeat(43)),
    true,
  );
  assertEquals(
    response.headers.getSetCookie()[0].includes("A".repeat(43)),
    false,
  );
});

Deno.test("framework error boundaries can decorate a response after a route throws", async () => {
  const { middleware } = make_fixture();
  const context = pipeline_context(
    new Request("http://localhost/method-not-allowed"),
    () => {
      throw new Error("route failure");
    },
  );

  await assertRejects(() => middleware.handle(context), Error, "route failure");
  const response = middleware.decorate(
    context.state,
    new Response("Internal server error", { status: 500 }),
  );

  assertEquals(response.status, 500);
  assertEquals(response.headers.get("x-request-id"), "request-1");
  assertEquals(response.headers.getSetCookie().length, 1);
  assertEquals(await response.text(), "Internal server error");
});

Deno.test("malformed browser credentials receive a replacement guest cookie", async () => {
  const { middleware } = make_fixture();
  const context = pipeline_context(
    new Request("http://localhost/missing", {
      headers: { cookie: "iam_pager_session_local=attacker-chosen" },
    }),
    (state) => {
      assertEquals(state.request_context.session.kind, "guest");
      assertEquals(state.request_context.session.session_id, "session-1");
      return new Response("page not found", { status: 404 });
    },
  );

  const response = await middleware.handle(context);

  assertEquals(response.status, 404);
  assertEquals(response.headers.get("x-request-id"), "request-1");
  const cookie = response.headers.getSetCookie()[0];
  assertExists(cookie);
  assertEquals(cookie.includes("attacker-chosen"), false);
});
