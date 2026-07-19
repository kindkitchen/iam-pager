import { assert, assertEquals } from "@std/assert";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import type { AuthenticatedSession, Session } from "../session/model.ts";
import type { NamespaceReservationManager } from "./interfaces.ts";
import { MemoryNamespaceRepository } from "./memory-repository.ts";
import type { NamespaceReservation } from "./model.ts";
import { NamespaceReservationService } from "./service.ts";
import {
  NamespaceHttpAdapter,
  type NamespaceHttpRequestContext,
  reserve_namespace_request_max_bytes,
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
const csrf_token = "c".repeat(43);
const authenticated_session: AuthenticatedSession = {
  ...guest_session,
  kind: "authenticated",
  session_version: 3,
  user_id: "user-1",
  authenticated_at: now,
  idle_expires_at: new Date("2026-08-17T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-10-16T12:00:00.000Z"),
  csrf_token,
};

function make_adapter() {
  const engine = new LocatorEngine({
    strategies: [new PathSlugStrategy()],
    forbidden_namespaces: ["site", "api", "auth"],
  });
  const namespaces = new NamespaceReservationService({
    engine,
    repository: new MemoryNamespaceRepository(),
  });
  return {
    adapter: new NamespaceHttpAdapter({ namespaces, engine }),
    namespaces,
  };
}

function context(session: Session): NamespaceHttpRequestContext {
  return { request_id: "request-1", session };
}

function reserve_request(
  body: unknown,
  content_type = "application/json",
): Request {
  return new Request("https://pager.test/api/namespaces", {
    method: "POST",
    headers: { "content-type": content_type },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function list_request(): Request {
  return new Request("https://pager.test/api/namespaces");
}

Deno.test("reserve requires an authenticated session", async () => {
  const { adapter } = make_adapter();
  const response = await adapter.reserve(
    reserve_request({ namespace: "Ada", csrf_token }),
    context(guest_session),
  );
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "not_authenticated");
});

Deno.test("reserve requires a JSON content type", async () => {
  const { adapter } = make_adapter();
  const response = await adapter.reserve(
    reserve_request("namespace=Ada", "application/x-www-form-urlencoded"),
    context(authenticated_session),
  );
  assertEquals(response.status, 415);
  assertEquals((await response.json()).error, "unsupported_media_type");
});

Deno.test("reserve bounds request buffering", async () => {
  const { adapter } = make_adapter();
  const oversized = JSON.stringify({
    namespace: "a".repeat(reserve_namespace_request_max_bytes),
    csrf_token,
  });
  const response = await adapter.reserve(
    reserve_request(oversized),
    context(authenticated_session),
  );
  assertEquals(response.status, 413);
  assertEquals((await response.json()).error, "request_too_large");
});

Deno.test("reserve rejects malformed JSON and non-object bodies", async () => {
  const { adapter } = make_adapter();
  const invalid = await adapter.reserve(
    reserve_request("{not json"),
    context(authenticated_session),
  );
  assertEquals(invalid.status, 400);
  assertEquals((await invalid.json()).error, "invalid_json");

  for (
    const body of [
      ["Ada"],
      '"Ada"',
      { csrf_token },
      { namespace: "Ada" },
      { namespace: 7 },
    ]
  ) {
    const response = await adapter.reserve(
      reserve_request(body),
      context(authenticated_session),
    );
    assertEquals(response.status, 400);
    assertEquals((await response.json()).error, "invalid_request");
  }
});

Deno.test("reserve rejects a wrong or differently sized CSRF token", async () => {
  const { adapter, namespaces } = make_adapter();
  for (const wrong of ["d".repeat(43), "c".repeat(42), ""]) {
    const response = await adapter.reserve(
      reserve_request({ namespace: "Ada", csrf_token: wrong }),
      context(authenticated_session),
    );
    assertEquals(response.status, 403);
    assertEquals((await response.json()).error, "invalid_csrf");
  }
  assertEquals(await namespaces.list_owned("user-1"), []);
});

Deno.test("reserve claims a namespace and returns its public path", async () => {
  const { adapter, namespaces } = make_adapter();
  const response = await adapter.reserve(
    reserve_request({ namespace: "Ada Lovelace", csrf_token }),
    context(authenticated_session),
  );
  assertEquals(response.status, 201);
  assertEquals(response.headers.get("location"), "/Ada%20Lovelace");
  assertEquals(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert(body.ok);
  assertEquals(body.reservation.namespace, "Ada Lovelace");
  assertEquals(body.reservation.path, "/Ada%20Lovelace");
  assert(!Number.isNaN(Date.parse(body.reservation.reserved_at)));
  const owned = await namespaces.list_owned("user-1");
  assertEquals(owned.length, 1);
  assertEquals(owned[0].namespace, "Ada Lovelace");
});

Deno.test("reserve maps typed manager failures to statuses", async () => {
  const { adapter } = make_adapter();
  const cases: readonly [unknown, number, string][] = [
    [{ namespace: "api", csrf_token }, 403, "forbidden_namespace"],
    [{ namespace: "a/b", csrf_token }, 422, "invalid_namespace"],
  ];
  for (const [body, status, error] of cases) {
    const response = await adapter.reserve(
      reserve_request(body),
      context(authenticated_session),
    );
    assertEquals(response.status, status);
    assertEquals((await response.json()).error, error);
  }
});

Deno.test("reserve reports a taken namespace case-insensitively", async () => {
  const { adapter } = make_adapter();
  const first = await adapter.reserve(
    reserve_request({ namespace: "Ada", csrf_token }),
    context(authenticated_session),
  );
  assertEquals(first.status, 201);
  const second = await adapter.reserve(
    reserve_request({ namespace: "ADA", csrf_token }),
    context(authenticated_session),
  );
  assertEquals(second.status, 409);
  assertEquals((await second.json()).error, "taken");
});

Deno.test("list_owned requires an authenticated session", async () => {
  const { adapter } = make_adapter();
  const response = await adapter.list_owned(
    list_request(),
    context(guest_session),
  );
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "not_authenticated");
});

Deno.test("list_owned returns an empty list for a new creator", async () => {
  const { adapter } = make_adapter();
  const response = await adapter.list_owned(
    list_request(),
    context(authenticated_session),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(await response.json(), { ok: true, reservations: [] });
});

Deno.test("list_owned returns only the caller's reservations", async () => {
  const { adapter, namespaces } = make_adapter();
  await namespaces.reserve({ namespace: "Mine", owner_user_id: "user-1" });
  await namespaces.reserve({ namespace: "Other", owner_user_id: "user-2" });
  const response = await adapter.list_owned(
    list_request(),
    context(authenticated_session),
  );
  const body = await response.json();
  assertEquals(
    body.reservations.map((entry: { namespace: string }) => entry.namespace),
    ["Mine"],
  );
});

Deno.test("list_owned presents a stable oldest-first order with paths", async () => {
  const engine = new LocatorEngine({ strategies: [new PathSlugStrategy()] });
  const reservations: NamespaceReservation[] = [
    {
      namespace: "bravo",
      owner_user_id: "user-1",
      reserved_at: new Date("2026-07-18T10:00:00.000Z"),
    },
    {
      namespace: "alpha",
      owner_user_id: "user-1",
      reserved_at: new Date("2026-07-18T09:00:00.000Z"),
    },
    {
      namespace: "Twin B",
      owner_user_id: "user-1",
      reserved_at: new Date("2026-07-18T09:00:00.000Z"),
    },
  ];
  const stub: NamespaceReservationManager = {
    reserve: () => Promise.reject(new Error("not under test")),
    list_owned: () => Promise.resolve(reservations),
  };
  const adapter = new NamespaceHttpAdapter({ namespaces: stub, engine });
  const response = await adapter.list_owned(
    list_request(),
    context(authenticated_session),
  );
  const body = await response.json();
  assertEquals(body.reservations, [
    {
      namespace: "alpha",
      path: "/alpha",
      reserved_at: "2026-07-18T09:00:00.000Z",
    },
    {
      namespace: "Twin B",
      path: "/Twin%20B",
      reserved_at: "2026-07-18T09:00:00.000Z",
    },
    {
      namespace: "bravo",
      path: "/bravo",
      reserved_at: "2026-07-18T10:00:00.000Z",
    },
  ]);
});
