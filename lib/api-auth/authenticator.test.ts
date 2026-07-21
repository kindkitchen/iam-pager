import { assertEquals } from "@std/assert";
import type { ApiKeyBearerResolver, ApiKeyPrincipal } from "../api-key/mod.ts";
import type { AuthenticatedSession, Session } from "../session/mod.ts";
import { BearerFirstApiRequestAuthenticator } from "./authenticator.ts";

const now = new Date("2026-07-23T12:00:00.000Z");

const guest_session: Session = {
  kind: "guest",
  session_id: "guest-session",
  session_version: 1,
  created_at: now,
  last_seen_at: now,
  absolute_expires_at: new Date("2026-07-30T12:00:00.000Z"),
};

const authenticated_session: AuthenticatedSession = {
  ...guest_session,
  kind: "authenticated",
  session_id: "user-session",
  session_version: 2,
  user_id: "user-1",
  authenticated_at: now,
  idle_expires_at: new Date("2026-08-23T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-10-23T12:00:00.000Z"),
  csrf_token: "c".repeat(43),
};

const key_principal: ApiKeyPrincipal = {
  kind: "api_key",
  api_key_id: "key-1",
  user_id: "user-1",
  permissions: ["read", "write"],
};

function make_authenticator(): {
  authenticator: BearerFirstApiRequestAuthenticator;
  resolved_bearers: string[];
} {
  const resolved_bearers: string[] = [];
  const bearer_resolver: ApiKeyBearerResolver = {
    resolve_bearer(bearer) {
      resolved_bearers.push(bearer);
      return Promise.resolve(bearer === "good-token" ? key_principal : null);
    },
  };
  return {
    authenticator: new BearerFirstApiRequestAuthenticator({ bearer_resolver }),
    resolved_bearers,
  };
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/pages", { headers });
}

Deno.test("without a header the session decides guest versus browser user", async () => {
  const { authenticator, resolved_bearers } = make_authenticator();

  const guest = await authenticator.authenticate(request(), guest_session);
  assertEquals(guest, { ok: true, principal: { kind: "guest" } });

  const user = await authenticator.authenticate(
    request(),
    authenticated_session,
  );
  assertEquals(user, {
    ok: true,
    principal: {
      kind: "browser_user",
      user_id: "user-1",
      csrf_token: "c".repeat(43),
    },
  });
  assertEquals(resolved_bearers, []);
});

Deno.test("a valid bearer resolves the key principal regardless of the session", async () => {
  const { authenticator } = make_authenticator();
  for (const session of [guest_session, authenticated_session]) {
    const result = await authenticator.authenticate(
      request({ authorization: "Bearer good-token" }),
      session,
    );
    assertEquals(result, { ok: true, principal: key_principal });
  }
});

Deno.test("malformed authorization headers fail before any bearer lookup", async () => {
  const { authenticator, resolved_bearers } = make_authenticator();
  const malformed = [
    "Basic Zm9vOmJhcg==",
    "bearer good-token",
    "BEARER good-token",
    "Bearer",
    "Bearer ",
    "Bearer good-token extra",
    "Bearer  good-token",
    "",
  ];
  for (const authorization of malformed) {
    const result = await authenticator.authenticate(
      request({ authorization }),
      authenticated_session,
    );
    assertEquals(result, { ok: false, reason: "invalid_bearer" });
  }
  assertEquals(resolved_bearers, []);
});

Deno.test("duplicate authorization headers are one malformed value", async () => {
  const { authenticator, resolved_bearers } = make_authenticator();
  const headers = new Headers();
  headers.append("authorization", "Bearer good-token");
  headers.append("authorization", "Bearer good-token");
  const result = await authenticator.authenticate(
    new Request("http://localhost/api/pages", { headers }),
    authenticated_session,
  );
  assertEquals(result, { ok: false, reason: "invalid_bearer" });
  assertEquals(resolved_bearers, []);
});

Deno.test("an unusable bearer never falls back to the valid cookie session", async () => {
  const { authenticator, resolved_bearers } = make_authenticator();
  const result = await authenticator.authenticate(
    request({ authorization: "Bearer revoked-token" }),
    authenticated_session,
  );
  assertEquals(result, { ok: false, reason: "invalid_bearer" });
  assertEquals(resolved_bearers, ["revoked-token"]);
});

Deno.test("the default authenticator fails closed on every explicit bearer", async () => {
  const authenticator = new BearerFirstApiRequestAuthenticator();
  const rejected = await authenticator.authenticate(
    request({ authorization: "Bearer good-token" }),
    authenticated_session,
  );
  assertEquals(rejected, { ok: false, reason: "invalid_bearer" });

  const session_backed = await authenticator.authenticate(
    request(),
    authenticated_session,
  );
  assertEquals(session_backed.ok, true);
});
