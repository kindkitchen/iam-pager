import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedSession, Session } from "../session/model.ts";
import { format_api_key_etag } from "./etag.ts";
import type { SecretGenerator } from "./interfaces.ts";
import {
  api_key_request_max_bytes,
  ApiKeyHttpAdapter,
  type ApiKeyHttpRequestContext,
} from "./http.ts";
import { MemoryApiKeyRepository } from "./memory-repository.ts";
import { ApiKeyService } from "./service.ts";

const now = new Date("2026-07-22T12:00:00.000Z");
const guest_session: Session = {
  kind: "guest",
  session_id: "session-1",
  session_version: 1,
  created_at: now,
  last_seen_at: now,
  absolute_expires_at: new Date("2026-07-29T12:00:00.000Z"),
};
const csrf_token = "c".repeat(43);
const authenticated_session: AuthenticatedSession = {
  ...guest_session,
  kind: "authenticated",
  session_version: 3,
  user_id: "user-1",
  authenticated_at: now,
  idle_expires_at: new Date("2026-08-21T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-10-20T12:00:00.000Z"),
  csrf_token,
};

class SequenceSecretGenerator implements SecretGenerator {
  #next = 0;
  generate(): string {
    return String(++this.#next).padStart(43, "0");
  }
}

function make_adapter() {
  let next_id = 0;
  const service = new ApiKeyService({
    repository: new MemoryApiKeyRepository(),
    clock: { now: () => new Date(now) },
    id_generator: { generate: () => `key-${++next_id}` },
    secret_generator: new SequenceSecretGenerator(),
  });
  return { adapter: new ApiKeyHttpAdapter({ api_keys: service }), service };
}

function context(session: Session): ApiKeyHttpRequestContext {
  return { request_id: "request-1", session };
}

const collection_url = "https://pager.test/api/api-keys";

function create_request(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(collection_url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrf_token,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function created_key(
  adapter: ApiKeyHttpAdapter,
  body: Record<string, unknown> = { label: "ci", permissions: ["all"] },
): Promise<{ api_key_id: string; revision: number; bearer: string }> {
  const response = await adapter.create(
    create_request(body),
    context(authenticated_session),
  );
  assertEquals(response.status, 201);
  const payload = await response.json();
  return {
    api_key_id: payload.api_key.api_key_id,
    revision: payload.api_key.revision,
    bearer: payload.bearer,
  };
}

Deno.test("management endpoints require an authenticated browser session", async () => {
  const { adapter } = make_adapter();
  const guest = context(guest_session);
  const cases = [
    adapter.list(new Request(collection_url), guest),
    adapter.create(
      create_request({ label: "x", permissions: ["read"] }),
      guest,
    ),
    adapter.inspect(new Request(`${collection_url}/key-1`), guest, "key-1"),
  ];
  for (const pending of cases) {
    const response = await pending;
    assertEquals(response.status, 401);
    assertEquals((await response.json()).error, "not_authenticated");
  }
});

Deno.test("management endpoints reject explicit bearers without cookie fallback", async () => {
  const { adapter } = make_adapter();
  const key = await created_key(adapter);
  const with_bearer = { authorization: `Bearer ${key.bearer}` };
  const responses = [
    await adapter.list(
      new Request(collection_url, { headers: with_bearer }),
      context(authenticated_session),
    ),
    await adapter.create(
      create_request({ label: "x", permissions: ["read"] }, with_bearer),
      context(authenticated_session),
    ),
    await adapter.inspect(
      new Request(`${collection_url}/${key.api_key_id}`, {
        headers: with_bearer,
      }),
      context(authenticated_session),
      key.api_key_id,
    ),
  ];
  for (const response of responses) {
    assertEquals(response.status, 401);
    assertEquals(
      response.headers.get("www-authenticate"),
      'Bearer realm="api"',
    );
    assertEquals((await response.json()).error, "invalid_bearer");
  }
});

Deno.test("create enforces media type, bounds, schema, and CSRF", async () => {
  const { adapter } = make_adapter();
  const authed = context(authenticated_session);

  const wrong_type = await adapter.create(
    new Request(collection_url, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-csrf-token": csrf_token },
      body: "label=x",
    }),
    authed,
  );
  assertEquals(wrong_type.status, 415);

  const oversized = await adapter.create(
    create_request({
      label: "a".repeat(api_key_request_max_bytes),
      permissions: ["read"],
    }),
    authed,
  );
  assertEquals(oversized.status, 413);

  const malformed = await adapter.create(create_request("{not json"), authed);
  assertEquals(malformed.status, 400);
  assertEquals((await malformed.json()).error, "invalid_json");

  for (
    const body of [
      { permissions: ["read"] },
      { label: "x" },
      { label: "x", permissions: ["read"], extra: true },
      { label: 7, permissions: ["read"] },
      { label: "x", permissions: "read" },
      { label: "x", permissions: [7] },
      { label: "x", permissions: ["read"], expires_at: "tomorrow" },
      { label: "x", permissions: ["read"], expires_at: 7 },
    ]
  ) {
    const response = await adapter.create(create_request(body), authed);
    assertEquals(response.status, 400, JSON.stringify(body));
    assertEquals((await response.json()).error, "invalid_request");
  }

  const wrong_csrf = await adapter.create(
    create_request({ label: "x", permissions: ["read"] }, {
      "x-csrf-token": "d".repeat(43),
    }),
    authed,
  );
  assertEquals(wrong_csrf.status, 403);
  assertEquals((await wrong_csrf.json()).error, "invalid_csrf");

  const invalid_permission = await adapter.create(
    create_request({ label: "x", permissions: ["admin"] }),
    authed,
  );
  assertEquals(invalid_permission.status, 422);
  assertEquals((await invalid_permission.json()).error, "invalid_permissions");
});

Deno.test("create returns the bearer exactly once with an ETag", async () => {
  const { adapter } = make_adapter();
  const response = await adapter.create(
    create_request({
      label: "ci",
      permissions: ["all"],
      expires_at: "2027-01-01T00:00:00.000Z",
    }),
    context(authenticated_session),
  );
  assertEquals(response.status, 201);
  assertEquals(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert(body.ok);
  assert(body.bearer.startsWith("iamp_"));
  assertEquals(body.api_key.permissions, ["read", "write", "delete"]);
  assertEquals(body.api_key.status, "active");
  assertEquals(body.api_key.expires_at, "2027-01-01T00:00:00.000Z");
  assertEquals(
    response.headers.get("etag"),
    format_api_key_etag(body.api_key.api_key_id, 1),
  );

  const list = await adapter.list(
    new Request(collection_url),
    context(authenticated_session),
  );
  const listed = await list.json();
  assertEquals(listed.api_keys.length, 1);
  assert(!JSON.stringify(listed).includes(body.bearer));
});

Deno.test("inspect is owner-scoped and non-disclosing", async () => {
  const { adapter } = make_adapter();
  const key = await created_key(adapter);
  const foreign_session: AuthenticatedSession = {
    ...authenticated_session,
    user_id: "user-2",
  };
  const foreign = await adapter.inspect(
    new Request(`${collection_url}/${key.api_key_id}`),
    context(foreign_session),
    key.api_key_id,
  );
  assertEquals(foreign.status, 404);
  const missing = await adapter.inspect(
    new Request(`${collection_url}/absent`),
    context(authenticated_session),
    "absent",
  );
  assertEquals(missing.status, 404);
  assertEquals(await foreign.json(), await missing.json());

  const found = await adapter.inspect(
    new Request(`${collection_url}/${key.api_key_id}`),
    context(authenticated_session),
    key.api_key_id,
  );
  assertEquals(found.status, 200);
  assertEquals(
    found.headers.get("etag"),
    format_api_key_etag(key.api_key_id, 1),
  );
});

Deno.test("update requires a matching strong If-Match", async () => {
  const { adapter } = make_adapter();
  const key = await created_key(adapter);
  const url = `${collection_url}/${key.api_key_id}`;
  const body = { label: "renamed", permissions: ["read"], expires_at: null };

  const request = (headers: Record<string, string>) =>
    new Request(url, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrf_token,
        ...headers,
      },
      body: JSON.stringify(body),
    });

  const missing = await adapter.update(
    request({}),
    context(authenticated_session),
    key.api_key_id,
  );
  assertEquals(missing.status, 428);

  const mismatched = await adapter.update(
    request({ "if-match": format_api_key_etag("other", 1) }),
    context(authenticated_session),
    key.api_key_id,
  );
  assertEquals(mismatched.status, 412);

  const stale = await adapter.update(
    request({ "if-match": format_api_key_etag(key.api_key_id, 9) }),
    context(authenticated_session),
    key.api_key_id,
  );
  assertEquals(stale.status, 412);

  const updated = await adapter.update(
    request({ "if-match": format_api_key_etag(key.api_key_id, 1) }),
    context(authenticated_session),
    key.api_key_id,
  );
  assertEquals(updated.status, 200);
  const payload = await updated.json();
  assertEquals(payload.api_key.label, "renamed");
  assertEquals(payload.api_key.revision, 2);
  assertEquals(
    updated.headers.get("etag"),
    format_api_key_etag(key.api_key_id, 2),
  );
  assert(!("bearer" in payload));
});

Deno.test("individual delete requires CSRF and If-Match, then revokes", async () => {
  const { adapter, service } = make_adapter();
  const key = await created_key(adapter);
  const url = `${collection_url}/${key.api_key_id}`;

  const no_csrf = await adapter.revoke(
    new Request(url, { method: "DELETE" }),
    context(authenticated_session),
    key.api_key_id,
  );
  assertEquals(no_csrf.status, 403);

  const no_precondition = await adapter.revoke(
    new Request(url, {
      method: "DELETE",
      headers: { "x-csrf-token": csrf_token },
    }),
    context(authenticated_session),
    key.api_key_id,
  );
  assertEquals(no_precondition.status, 428);

  const revoked = await adapter.revoke(
    new Request(url, {
      method: "DELETE",
      headers: {
        "x-csrf-token": csrf_token,
        "if-match": format_api_key_etag(key.api_key_id, 1),
      },
    }),
    context(authenticated_session),
    key.api_key_id,
  );
  assertEquals(revoked.status, 200);
  assertEquals(await service.resolve_bearer(key.bearer), null);

  const repeated = await adapter.revoke(
    new Request(url, {
      method: "DELETE",
      headers: {
        "x-csrf-token": csrf_token,
        "if-match": format_api_key_etag(key.api_key_id, 1),
      },
    }),
    context(authenticated_session),
    key.api_key_id,
  );
  assertEquals(repeated.status, 404);
});

Deno.test("browser revoke-all requires CSRF and stays bodyless", async () => {
  const { adapter } = make_adapter();
  await created_key(adapter);
  await created_key(adapter, { label: "second", permissions: ["read"] });

  const with_body = await adapter.revoke_all(
    new Request(collection_url, {
      method: "DELETE",
      headers: { "x-csrf-token": csrf_token },
      body: "{}",
    }),
    context(authenticated_session),
  );
  assertEquals(with_body.status, 400);

  const no_csrf = await adapter.revoke_all(
    new Request(collection_url, { method: "DELETE" }),
    context(authenticated_session),
  );
  assertEquals(no_csrf.status, 403);

  const revoked = await adapter.revoke_all(
    new Request(collection_url, {
      method: "DELETE",
      headers: { "x-csrf-token": csrf_token },
    }),
    context(authenticated_session),
  );
  assertEquals(revoked.status, 200);
  assertEquals((await revoked.json()).revoked_count, 2);
});

Deno.test("bearer revoke-all requires the delete permission", async () => {
  const { adapter, service } = make_adapter();
  const reader = await created_key(adapter, {
    label: "reader",
    permissions: ["read"],
  });
  const deleter = await created_key(adapter, {
    label: "deleter",
    permissions: ["all"],
  });

  const revoke_all = (authorization: string) =>
    adapter.revoke_all(
      new Request(collection_url, {
        method: "DELETE",
        headers: { authorization },
      }),
      context(guest_session),
    );

  const malformed = await revoke_all("Bearer");
  assertEquals(malformed.status, 401);
  const unknown = await revoke_all(`Bearer iamp_${"x".repeat(43)}`);
  assertEquals(unknown.status, 401);
  const insufficient = await revoke_all(`Bearer ${reader.bearer}`);
  assertEquals(insufficient.status, 403);
  assertEquals((await insufficient.json()).error, "insufficient_permission");

  const revoked = await revoke_all(`Bearer ${deleter.bearer}`);
  assertEquals(revoked.status, 200);
  assertEquals((await revoked.json()).revoked_count, 2);
  assertEquals(await service.resolve_bearer(deleter.bearer), null);
  assertEquals(await service.resolve_bearer(reader.bearer), null);

  const repeated = await revoke_all(`Bearer ${deleter.bearer}`);
  assertEquals(repeated.status, 401);
});
