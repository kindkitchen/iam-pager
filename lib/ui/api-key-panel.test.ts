import { assert, assertEquals } from "@std/assert";
import type { ApiKeyManager } from "../api-key/interfaces.ts";
import type { ApiKeyMetadata } from "../api-key/model.ts";
import type { AuthenticatedSession, Session } from "../session/model.ts";
import {
  api_key_draft_violation,
  api_key_panel_failure,
  CreatorApiKeyPanelPresenter,
  generated_api_key_from_api,
  panel_key_from_api,
  panel_key_list_from_api,
  prepare_api_key_create_request,
  prepare_api_key_list_request,
  prepare_api_key_revoke_all_request,
  prepare_api_key_revoke_request,
  prepare_api_key_update_request,
  revoked_count_from_api,
} from "./api-key-panel.ts";

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
  session_version: 2,
  user_id: "user-private-id",
  authenticated_at: now,
  idle_expires_at: new Date("2026-08-21T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-10-20T12:00:00.000Z"),
  csrf_token,
};

const metadata: ApiKeyMetadata = {
  api_key_id: "key-1",
  owner_user_id: "user-private-id",
  label: "ci",
  permissions: ["read", "write"],
  created_at: now,
  updated_at: now,
  expires_at: null,
  revision: 2,
  status: "active",
};

function stub_manager(keys: readonly ApiKeyMetadata[]): ApiKeyManager {
  return {
    list_owned: () => Promise.resolve([...keys]),
    create: () => Promise.reject(new Error("not under test")),
    inspect: () => Promise.reject(new Error("not under test")),
    update: () => Promise.reject(new Error("not under test")),
    revoke: () => Promise.reject(new Error("not under test")),
    revoke_all: () => Promise.reject(new Error("not under test")),
  };
}

Deno.test("presenter hides the panel from guests", async () => {
  const presenter = new CreatorApiKeyPanelPresenter({
    api_keys: stub_manager([metadata]),
  });
  assertEquals(await presenter.present(guest_session), { kind: "hidden" });
});

Deno.test("presenter derives a complete serializable creator model", async () => {
  const presenter = new CreatorApiKeyPanelPresenter({
    api_keys: stub_manager([
      metadata,
      {
        ...metadata,
        api_key_id: "key-2",
        expires_at: new Date("2026-08-01T00:00:00.000Z"),
        status: "expired",
        revision: 1,
      },
    ]),
  });
  const panel = await presenter.present(authenticated_session);
  assert(panel.kind === "creator");
  assertEquals(panel.csrf_token, csrf_token);
  assertEquals(panel.api_keys, [
    {
      api_key_id: "key-1",
      label: "ci",
      permissions: ["read", "write"],
      status: "active",
      expires_at: null,
      created_at: now.toISOString(),
      revision: 2,
      etag: '"api-key-key-1-r2"',
    },
    {
      api_key_id: "key-2",
      label: "ci",
      permissions: ["read", "write"],
      status: "expired",
      expires_at: "2026-08-01T00:00:00.000Z",
      created_at: now.toISOString(),
      revision: 1,
      etag: '"api-key-key-2-r1"',
    },
  ]);
  const serialized = JSON.stringify(panel);
  assert(!serialized.includes("user-private-id"));
  assert(!serialized.includes("owner_user_id"));
  assert(!serialized.includes("secret"));
});

Deno.test("draft violations mirror the raw domain rules", () => {
  const valid = {
    label: "ci",
    permissions: ["read"],
    expires_at: null,
  };
  assertEquals(api_key_draft_violation(valid, now), null);
  assertEquals(
    api_key_draft_violation(
      { ...valid, expires_at: "2026-08-01T00:00:00.000Z" },
      now,
    ),
    null,
  );
  assert(api_key_draft_violation({ ...valid, label: "  " }, now) !== null);
  assert(
    api_key_draft_violation({ ...valid, label: "a".repeat(65) }, now) !== null,
  );
  assert(api_key_draft_violation({ ...valid, permissions: [] }, now) !== null);
  assert(
    api_key_draft_violation({ ...valid, expires_at: "not a date" }, now) !==
      null,
  );
  assert(
    api_key_draft_violation(
      { ...valid, expires_at: now.toISOString() },
      now,
    ) !== null,
  );
});

Deno.test("request builders map onto the strict wire contract", () => {
  const list = prepare_api_key_list_request();
  assertEquals(list, {
    url: "/api/api-keys",
    method: "GET",
    headers: new Headers(),
  });

  const draft = {
    label: "ci",
    permissions: ["all"],
    expires_at: "2026-08-01T00:00:00.000Z",
  };
  const create = prepare_api_key_create_request(csrf_token, draft);
  assertEquals(create.url, "/api/api-keys");
  assertEquals(create.method, "POST");
  assertEquals(create.headers.get("x-csrf-token"), csrf_token);
  assertEquals(create.headers.get("content-type"), "application/json");
  assertEquals(create.headers.get("if-match"), null);
  assertEquals(create.body, draft);

  const target = { api_key_id: "key 1", etag: '"api-key-key-1-r2"' };
  const update = prepare_api_key_update_request(csrf_token, target, draft);
  assertEquals(update.url, "/api/api-keys/key%201");
  assertEquals(update.method, "PATCH");
  assertEquals(update.headers.get("if-match"), target.etag);
  assertEquals(update.headers.get("x-csrf-token"), csrf_token);
  assertEquals(update.body, draft);

  const revoke = prepare_api_key_revoke_request(csrf_token, target);
  assertEquals(revoke.url, "/api/api-keys/key%201");
  assertEquals(revoke.method, "DELETE");
  assertEquals(revoke.headers.get("if-match"), target.etag);
  assertEquals(revoke.headers.get("content-type"), null);
  assertEquals(revoke.body, undefined);

  const revoke_all = prepare_api_key_revoke_all_request(csrf_token);
  assertEquals(revoke_all.url, "/api/api-keys");
  assertEquals(revoke_all.method, "DELETE");
  assertEquals(revoke_all.headers.get("if-match"), null);
  assertEquals(revoke_all.body, undefined);
});

const wire_key = {
  api_key_id: "key-1",
  label: "ci",
  permissions: ["read"],
  status: "active",
  expires_at: null,
  created_at: "2026-07-22T12:00:00.000Z",
  updated_at: "2026-07-22T12:00:00.000Z",
  revision: 1,
};

Deno.test("panel key decoding validates every field", () => {
  const decoded = panel_key_from_api(wire_key);
  assert(decoded !== null);
  assertEquals(decoded.etag, '"api-key-key-1-r1"');

  for (
    const broken of [
      null,
      [],
      { ...wire_key, api_key_id: "" },
      { ...wire_key, label: 7 },
      { ...wire_key, permissions: "read" },
      { ...wire_key, permissions: [7] },
      { ...wire_key, status: "revoked" },
      { ...wire_key, expires_at: "tomorrow" },
      { ...wire_key, created_at: "yesterday" },
      { ...wire_key, revision: 0 },
      { ...wire_key, revision: 1.5 },
    ]
  ) {
    assertEquals(panel_key_from_api(broken), null, JSON.stringify(broken));
  }
});

Deno.test("list, create, and revoke-all decoding stay strict", () => {
  assert(panel_key_list_from_api({ ok: true, api_keys: [wire_key] }) !== null);
  assertEquals(panel_key_list_from_api({ ok: true, api_keys: [{}] }), null);
  assertEquals(panel_key_list_from_api({ ok: false, api_keys: [] }), null);

  const generated = generated_api_key_from_api({
    ok: true,
    api_key: wire_key,
    bearer: `iamp_${"a".repeat(43)}`,
  });
  assert(generated !== null);
  assertEquals(generated.api_key.api_key_id, "key-1");
  assertEquals(
    generated_api_key_from_api({ ok: true, api_key: wire_key, bearer: "" }),
    null,
  );
  assertEquals(
    generated_api_key_from_api({ ok: true, api_key: {}, bearer: "x" }),
    null,
  );

  assertEquals(revoked_count_from_api({ ok: true, revoked_count: 3 }), 3);
  assertEquals(revoked_count_from_api({ ok: true, revoked_count: -1 }), null);
  assertEquals(revoked_count_from_api({ ok: false }), null);
});

Deno.test("failure mapping distinguishes stale revisions", () => {
  assertEquals(api_key_panel_failure(412, {}).kind, "stale");
  assertEquals(api_key_panel_failure(428, {}).kind, "stale");
  const detailed = api_key_panel_failure(422, {
    ok: false,
    error: "invalid_label",
    detail: "label must be 1-64 characters",
  });
  assertEquals(detailed.kind, "request");
  assertEquals(detailed.message, "label must be 1-64 characters");
  assertEquals(api_key_panel_failure(401, {}).kind, "request");
  assertEquals(api_key_panel_failure(500, null).message.includes("500"), true);
});
