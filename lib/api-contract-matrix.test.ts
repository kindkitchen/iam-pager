import { assert, assertEquals } from "@std/assert";
import { type AppServices, create_app_services } from "./app.ts";
import type { AuthenticatedSession, Session } from "./session/model.ts";

/**
 * Final contract matrix (QT-VERIFY / docs/api/authentication.md): every API
 * endpoint is exercised with each principal class — guest browser, browser
 * owner, a key with the mapped permission, a key without it, a revoked key,
 * and an explicit invalid bearer — proving the documented matrix end to end.
 *
 * "Allowed" rows assert only that authentication and authorization passed
 * (never 401/403); domain preconditions such as stale `If-Match` values are
 * deliberately used so allowed mutation rows do not destroy shared fixtures.
 */

const now = new Date("2026-07-22T12:00:00.000Z");
const csrf_token = "c".repeat(43);
const owner_user_id = "user-1";

const guest_session: Session = {
  kind: "guest",
  session_id: "guest-session",
  session_version: 1,
  created_at: now,
  last_seen_at: now,
  absolute_expires_at: new Date("2026-07-29T12:00:00.000Z"),
};
const owner_session: AuthenticatedSession = {
  ...guest_session,
  kind: "authenticated",
  session_id: "owner-session",
  session_version: 2,
  user_id: owner_user_id,
  authenticated_at: now,
  idle_expires_at: new Date("2026-08-22T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-10-22T12:00:00.000Z"),
  csrf_token,
};

const invalid_bearer = `iamp_${"x".repeat(43)}`;

interface MatrixFixture {
  readonly services: AppServices;
  readonly page_id: string;
  readonly bearers: {
    readonly read: string;
    readonly write: string;
    readonly delete: string;
    readonly revoked: string;
  };
}

async function create_bearer(
  services: AppServices,
  label: string,
  permissions: readonly string[],
): Promise<string> {
  const created = await services.api_keys.create({
    owner_user_id,
    label,
    permissions: [...permissions],
    expires_at: null,
  });
  if (!created.ok) throw new Error(`key creation failed: ${label}`);
  return created.bearer;
}

async function setup(): Promise<MatrixFixture> {
  const services = create_app_services();
  const reserved = await services.namespaces.reserve({
    namespace: "Robot",
    owner_user_id,
  });
  assert(reserved.ok);
  const read = await create_bearer(services, "read", ["read"]);
  const write = await create_bearer(services, "write", ["write"]);
  const delete_bearer = await create_bearer(services, "delete", ["delete"]);
  const revoked_created = await services.api_keys.create({
    owner_user_id,
    label: "revoked",
    permissions: ["all"],
    expires_at: null,
  });
  if (!revoked_created.ok) throw new Error("revoked key creation failed");
  const revoke = await services.api_keys.revoke(
    owner_user_id,
    revoked_created.api_key.api_key_id,
    revoked_created.api_key.revision,
  );
  assert(revoke.ok);

  const created_page = await services.pages_http.collection(
    new Request("https://pager.test/api/pages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrf_token,
      },
      body: JSON.stringify({
        locator: { namespace: "Robot", page_name: "fixture" },
        access: "private",
        content: { content_type: "md-page", input: { md: "# Fixture" } },
      }),
    }),
    { request_id: "setup", session: owner_session },
  );
  assertEquals(created_page.status, 201);
  const page_id = (await created_page.json()).page.page_id as string;
  return {
    services,
    page_id,
    bearers: {
      read,
      write,
      delete: delete_bearer,
      revoked: revoked_created.bearer,
    },
  };
}

type Dispatch = (
  services: AppServices,
  request: Request,
  session: Session,
) => Promise<Response>;

interface EndpointCase {
  readonly name: string;
  /** Builds a fresh request; `headers` already carry credential material. */
  readonly request: (
    fixture: MatrixFixture,
    headers: Record<string, string>,
    variant: "browser" | "key",
  ) => Request;
  readonly dispatch: Dispatch;
  /** Bearer with the mapped permission for the allowed key row. */
  readonly allowed_permission: "read" | "write" | "delete";
  /** Bearer lacking the mapped permission for the 403 row. */
  readonly denied_permission: "read" | "write" | "delete";
}

const stale_if_match = (page_id: string) => `"page-${page_id}-r999"`;

const page_collection: Dispatch = (services, request, session) =>
  services.pages_http.collection(request, { request_id: "r", session });
const page_item: Dispatch = (services, request, session) =>
  services.pages_http.item(request, { request_id: "r", session });
const page_item_action: Dispatch = (services, request, session) =>
  services.pages_http.item_action(request, { request_id: "r", session });
const page_bulk: Dispatch = (services, request, session) =>
  services.pages_http.bulk(request, { request_id: "r", session });
const namespace_list: Dispatch = (services, request, session) =>
  services.namespaces_http.list_owned(request, { request_id: "r", session });
const namespace_reserve: Dispatch = (services, request, session) =>
  services.namespaces_http.reserve(request, { request_id: "r", session });

let unique = 0;
function unique_name(prefix: string): string {
  unique += 1;
  return `${prefix}-${unique}`;
}

const endpoint_cases: readonly EndpointCase[] = [
  {
    name: "GET /api/pages",
    request: (_fixture, headers) =>
      new Request("https://pager.test/api/pages", { headers }),
    dispatch: page_collection,
    allowed_permission: "read",
    denied_permission: "write",
  },
  {
    name: "POST /api/pages",
    request: (_fixture, headers) =>
      new Request("https://pager.test/api/pages", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          locator: { namespace: "Robot", page_name: unique_name("create") },
          access: "public",
          content: { content_type: "md-page", input: { md: "# Row" } },
        }),
      }),
    dispatch: page_collection,
    allowed_permission: "write",
    denied_permission: "read",
  },
  {
    name: "GET /api/pages/:id",
    request: (fixture, headers) =>
      new Request(`https://pager.test/api/pages/${fixture.page_id}`, {
        headers,
      }),
    dispatch: page_item,
    allowed_permission: "read",
    denied_permission: "delete",
  },
  {
    name: "PATCH /api/pages/:id",
    request: (fixture, headers) =>
      new Request(`https://pager.test/api/pages/${fixture.page_id}`, {
        method: "PATCH",
        headers: {
          ...headers,
          "content-type": "application/json",
          "if-match": stale_if_match(fixture.page_id),
        },
        body: JSON.stringify({ access: "private" }),
      }),
    dispatch: page_item,
    allowed_permission: "write",
    denied_permission: "read",
  },
  {
    name: "DELETE /api/pages/:id",
    request: (fixture, headers) =>
      new Request(`https://pager.test/api/pages/${fixture.page_id}`, {
        method: "DELETE",
        headers: {
          ...headers,
          "if-match": stale_if_match(fixture.page_id),
        },
      }),
    dispatch: page_item,
    allowed_permission: "delete",
    denied_permission: "write",
  },
  {
    name: "POST /api/pages/:id/rename",
    request: (fixture, headers) =>
      new Request(
        `https://pager.test/api/pages/${fixture.page_id}/rename`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "if-match": stale_if_match(fixture.page_id),
          },
          body: JSON.stringify({ page_name: "renamed" }),
        },
      ),
    dispatch: page_item_action,
    allowed_permission: "write",
    denied_permission: "delete",
  },
  {
    name: "POST /api/pages/:id/duplicate",
    request: (fixture, headers) =>
      new Request(
        `https://pager.test/api/pages/${fixture.page_id}/duplicate`,
        {
          method: "POST",
          headers: {
            ...headers,
            "if-match": stale_if_match(fixture.page_id),
          },
        },
      ),
    dispatch: page_item_action,
    allowed_permission: "write",
    denied_permission: "read",
  },
  {
    name: "POST /api/pages/bulk/access",
    request: (fixture, headers) =>
      new Request("https://pager.test/api/pages/bulk/access", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          access: "public",
          selection: [{ page_id: fixture.page_id, expected_revision: 999 }],
        }),
      }),
    dispatch: page_bulk,
    allowed_permission: "write",
    denied_permission: "delete",
  },
  {
    name: "POST /api/pages/bulk/delete",
    request: (fixture, headers) =>
      new Request("https://pager.test/api/pages/bulk/delete", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          selection: [{ page_id: fixture.page_id, expected_revision: 999 }],
        }),
      }),
    dispatch: page_bulk,
    allowed_permission: "delete",
    denied_permission: "write",
  },
  {
    name: "GET /api/namespaces",
    request: (_fixture, headers) =>
      new Request("https://pager.test/api/namespaces", { headers }),
    dispatch: namespace_list,
    allowed_permission: "read",
    denied_permission: "write",
  },
  {
    name: "POST /api/namespaces",
    request: (_fixture, headers, variant) =>
      new Request("https://pager.test/api/namespaces", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(
          variant === "browser"
            ? { namespace: unique_name("Ns"), csrf_token }
            : { namespace: unique_name("Ns") },
        ),
      }),
    dispatch: namespace_reserve,
    allowed_permission: "write",
    denied_permission: "read",
  },
];

function browser_mutation_headers(request_method: string): boolean {
  return request_method !== "GET";
}

Deno.test("contract matrix: every page and namespace endpoint enforces the documented principal rules", async (t) => {
  const fixture = await setup();
  const { services, bearers } = fixture;

  for (const endpoint of endpoint_cases) {
    await t.step(endpoint.name, async () => {
      // Browser owner passes authentication and authorization.
      const method = endpoint.request(fixture, {}, "browser").method;
      const owner_headers: Record<string, string> =
        browser_mutation_headers(method) ? { "x-csrf-token": csrf_token } : {};
      const owner = await endpoint.dispatch(
        services,
        endpoint.request(fixture, owner_headers, "browser"),
        owner_session,
      );
      assert(
        owner.status !== 401 && owner.status !== 403,
        `${endpoint.name}: browser owner rejected with ${owner.status}`,
      );
      await owner.body?.cancel();

      // Guest browser: only trial publication is reachable, and this
      // fixture's namespaces are reserved, so POST /api/pages fails on
      // authority, never as an authentication success.
      const guest = await endpoint.dispatch(
        services,
        endpoint.request(fixture, {}, "browser"),
        guest_session,
      );
      if (endpoint.name === "POST /api/pages") {
        // The guest reaches trial publication and fails on namespace
        // authority, not on authentication.
        assertEquals(guest.status, 403);
        assertEquals((await guest.json()).error, "namespace_reserved");
      } else {
        assertEquals(guest.status, 401, endpoint.name);
        assertEquals((await guest.json()).error, "not_authenticated");
      }

      // Key with the mapped permission passes authorization.
      const allowed = await endpoint.dispatch(
        services,
        endpoint.request(fixture, {
          authorization: `Bearer ${bearers[endpoint.allowed_permission]}`,
        }, "key"),
        guest_session,
      );
      assert(
        allowed.status !== 401 && allowed.status !== 403,
        `${endpoint.name}: mapped-permission key rejected with ${allowed.status}`,
      );
      await allowed.body?.cancel();

      // Valid key without the mapped permission.
      const denied = await endpoint.dispatch(
        services,
        endpoint.request(fixture, {
          authorization: `Bearer ${bearers[endpoint.denied_permission]}`,
        }, "key"),
        guest_session,
      );
      assertEquals(denied.status, 403, endpoint.name);
      assertEquals((await denied.json()).error, "insufficient_permission");

      // Revoked key and explicit invalid bearer share one challenge.
      for (const bearer of [bearers.revoked, invalid_bearer]) {
        const rejected = await endpoint.dispatch(
          services,
          endpoint.request(fixture, {
            authorization: `Bearer ${bearer}`,
          }, "key"),
          guest_session,
        );
        assertEquals(rejected.status, 401, endpoint.name);
        assertEquals((await rejected.json()).error, "invalid_bearer");
        assertEquals(
          rejected.headers.get("www-authenticate"),
          'Bearer realm="api"',
        );
      }
    });
  }
});

Deno.test("contract matrix: key management is browser-owned except bearer revoke-all", async (t) => {
  const fixture = await setup();
  const { services, bearers } = fixture;
  const context = { request_id: "r", session: guest_session } as const;
  const keys = await services.api_keys.list_owned(owner_user_id);
  const first_key = keys[0];
  assert(first_key !== undefined);

  const bearer_only_operations: readonly [
    string,
    (headers: Record<string, string>) => Promise<Response>,
  ][] = [
    [
      "GET /api/api-keys",
      (headers) =>
        services.api_keys_http.list(
          new Request("https://pager.test/api/api-keys", { headers }),
          context,
        ),
    ],
    [
      "POST /api/api-keys",
      (headers) =>
        services.api_keys_http.create(
          new Request("https://pager.test/api/api-keys", {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ label: "x", permissions: ["read"] }),
          }),
          context,
        ),
    ],
    [
      "GET /api/api-keys/:id",
      (headers) =>
        services.api_keys_http.inspect(
          new Request(
            `https://pager.test/api/api-keys/${first_key.api_key_id}`,
            { headers },
          ),
          context,
          first_key.api_key_id,
        ),
    ],
    [
      "PATCH /api/api-keys/:id",
      (headers) =>
        services.api_keys_http.update(
          new Request(
            `https://pager.test/api/api-keys/${first_key.api_key_id}`,
            {
              method: "PATCH",
              headers: {
                ...headers,
                "content-type": "application/json",
                "if-match": `"api-key-${first_key.api_key_id}-r1"`,
              },
              body: JSON.stringify({
                label: "x",
                permissions: ["read"],
                expires_at: null,
              }),
            },
          ),
          context,
          first_key.api_key_id,
        ),
    ],
    [
      "DELETE /api/api-keys/:id",
      (headers) =>
        services.api_keys_http.revoke(
          new Request(
            `https://pager.test/api/api-keys/${first_key.api_key_id}`,
            {
              method: "DELETE",
              headers: {
                ...headers,
                "if-match": `"api-key-${first_key.api_key_id}-r1"`,
              },
            },
          ),
          context,
          first_key.api_key_id,
        ),
    ],
  ];

  await t.step("explicit bearer never reaches key management", async () => {
    for (const [name, run] of bearer_only_operations) {
      // Even a fully-granted valid key is rejected without disclosure.
      for (
        const bearer of [bearers.delete, bearers.revoked, invalid_bearer]
      ) {
        const response = await run({ authorization: `Bearer ${bearer}` });
        assertEquals(response.status, 401, name);
        assertEquals((await response.json()).error, "invalid_bearer", name);
      }
    }
  });

  await t.step(
    "revoke-all needs the delete permission and self-invalidates",
    async () => {
      const revoke_all = (bearer: string) =>
        services.api_keys_http.revoke_all(
          new Request("https://pager.test/api/api-keys", {
            method: "DELETE",
            headers: { authorization: `Bearer ${bearer}` },
          }),
          context,
        );

      const denied = await revoke_all(bearers.write);
      assertEquals(denied.status, 403);
      assertEquals((await denied.json()).error, "insufficient_permission");

      const allowed = await revoke_all(bearers.delete);
      assertEquals(allowed.status, 200);
      assert((await allowed.json()).revoked_count >= 1);

      // The calling key is revoked with everything else.
      const replay = await revoke_all(bearers.delete);
      assertEquals(replay.status, 401);
      assertEquals((await replay.json()).error, "invalid_bearer");
    },
  );
});
