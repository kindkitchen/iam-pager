import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  CookieSessionStrategy,
  session_cookie_config,
} from "./cookie-strategy.ts";

const bearer = "A".repeat(43);
const expires_at = new Date("2026-07-24T12:00:00.000Z");

Deno.test("cookie strategy extracts only its configured opaque credential", () => {
  const strategy = new CookieSessionStrategy(session_cookie_config("local"));

  assertEquals(
    strategy.extract(
      new Request("http://localhost", {
        headers: {
          cookie: `other=value; iam_pager_session_local=${bearer}`,
        },
      }),
    ),
    bearer,
  );
  assertEquals(strategy.extract(new Request("http://localhost")), null);
});

Deno.test("production and local cookie attributes differ only explicitly", () => {
  const response = new Response(null);
  const production = new CookieSessionStrategy(
    session_cookie_config("production"),
  ).attach(response, { value: bearer, expires_at });
  const local = new CookieSessionStrategy(
    session_cookie_config("local"),
  ).attach(response, { value: bearer, expires_at });

  const production_cookie = production.headers.getSetCookie()[0];
  assertStringIncludes(
    production_cookie,
    `__Host-iam_pager_session=${bearer}`,
  );
  assertStringIncludes(production_cookie, "HttpOnly");
  assertStringIncludes(production_cookie, "Secure");
  assertStringIncludes(production_cookie, "SameSite=Lax");
  assertStringIncludes(production_cookie, "Path=/");
  assertStringIncludes(
    production_cookie,
    "Expires=Fri, 24 Jul 2026 12:00:00 GMT",
  );
  assertEquals(production_cookie.includes("Domain="), false);

  const local_cookie = local.headers.getSetCookie()[0];
  assertStringIncludes(local_cookie, `iam_pager_session_local=${bearer}`);
  assertStringIncludes(local_cookie, "HttpOnly");
  assertStringIncludes(local_cookie, "SameSite=Lax");
  assertStringIncludes(local_cookie, "Path=/");
  assertEquals(local_cookie.includes("Secure"), false);
  assertEquals(local_cookie.includes("Domain="), false);
});

Deno.test("cookie attachment preserves the response and existing cookies", async () => {
  const body = "isolated direct body";
  const original = new Response(body, {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(new TextEncoder().encode(body).byteLength),
      "content-security-policy": "sandbox; default-src 'none'",
      "x-existing": "yes",
      "set-cookie": "existing=value; Path=/",
    },
  });
  const strategy = new CookieSessionStrategy(
    session_cookie_config("production"),
  );

  const attached = strategy.attach(original, { value: bearer, expires_at });

  assertEquals(attached.status, 206);
  assertEquals(attached.statusText, "Partial Content");
  assertEquals(attached.headers.get("x-existing"), "yes");
  assertEquals(attached.headers.get("content-length"), "20");
  assertEquals(
    attached.headers.get("content-security-policy"),
    "sandbox; default-src 'none'",
  );
  assertEquals(attached.headers.getSetCookie().length, 2);
  assertEquals(await attached.text(), body);
});

Deno.test("cookie expiry uses the same host-only security attributes", () => {
  const strategy = new CookieSessionStrategy(
    session_cookie_config("production"),
  );
  const expired = strategy.expire(new Response(null));
  const cookie = expired.headers.getSetCookie()[0];

  assertStringIncludes(cookie, "__Host-iam_pager_session=");
  assertStringIncludes(cookie, "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  assertStringIncludes(cookie, "HttpOnly");
  assertStringIncludes(cookie, "Secure");
  assertStringIncludes(cookie, "SameSite=Lax");
  assertStringIncludes(cookie, "Path=/");
  assertEquals(cookie.includes("Domain="), false);

  assertThrows(
    () =>
      new CookieSessionStrategy({
        name: "__Host-invalid",
        secure: false,
      }),
    TypeError,
    "must be secure",
  );
});
