import { assertEquals, assertStringIncludes } from "@std/assert";
import { MdPageHandler, MemoryContentRepository } from "../content/mod.ts";
import { LocatorEngine, PathSlugStrategy } from "../locator/mod.ts";
import {
  MemoryNamespaceRepository,
  NamespaceReservationService,
} from "../namespace/mod.ts";
import type { Session } from "../session/model.ts";
import { deliver_locator_path } from "./http.ts";
import { NamespacePublishingAuthorizer } from "./namespace-authorizer.ts";
import { PublishingService } from "./service.ts";
import {
  guest_publish_request_max_bytes,
  publish_actor_from_session,
  publish_guest_md_page_request,
} from "./guest-http.ts";

function create_legacy_services() {
  const engine = new LocatorEngine({
    strategies: [new PathSlugStrategy()],
    forbidden_namespaces: ["site", "api", "auth"],
  });
  const namespace_repository = new MemoryNamespaceRepository();
  return {
    engine,
    namespaces: new NamespaceReservationService({
      engine,
      repository: namespace_repository,
    }),
    publishing: new PublishingService({
      engine,
      repository: new MemoryContentRepository(),
      handlers: [new MdPageHandler()],
      authorizer: new NamespacePublishingAuthorizer(namespace_repository),
    }),
  };
}

function json_request(body: unknown): Request {
  return new Request("https://pager.test/api/pages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("guest API publishes a named MdPage and returns its direct URL", async () => {
  const { engine, publishing } = create_legacy_services();
  const response = await publish_guest_md_page_request(
    json_request({
      namespace: "Ada Lovelace",
      page_name: "notes/today",
      md: "# Analytical Engine",
      css: "body { color: navy; }",
    }),
    publishing,
  );

  assertEquals(response.status, 201);
  assertEquals(response.headers.get("location"), "/Ada%20Lovelace/notes/today");
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(await response.json(), {
    ok: true,
    path: "/Ada%20Lovelace/notes/today",
    url: "https://pager.test/Ada%20Lovelace/notes/today",
  });

  const delivered = await deliver_locator_path(
    engine,
    publishing,
    "/ada%20lovelace/NOTES/TODAY",
  );
  assertEquals(delivered.status, 200);
  assertStringIncludes(await delivered.text(), "Analytical Engine");
});

Deno.test("guest API publishes a namespace default page", async () => {
  const { publishing } = create_legacy_services();
  const response = await publish_guest_md_page_request(
    json_request({ namespace: "guest", md: "default" }),
    publishing,
  );
  assertEquals(response.status, 201);
  assertEquals((await response.json()).path, "/guest");
});

Deno.test("guest API requires JSON", async () => {
  const { publishing } = create_legacy_services();
  const response = await publish_guest_md_page_request(
    new Request("https://pager.test/api/pages", {
      method: "POST",
      body: "namespace=guest",
    }),
    publishing,
  );
  assertEquals(response.status, 415);
  assertEquals((await response.json()).error, "unsupported_media_type");
});

Deno.test("guest API reports malformed JSON", async () => {
  const { publishing } = create_legacy_services();
  const response = await publish_guest_md_page_request(
    new Request("https://pager.test/api/pages", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: "{",
    }),
    publishing,
  );
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "invalid_json");
});

Deno.test("guest API validates its request shape", async () => {
  const { publishing } = create_legacy_services();
  const response = await publish_guest_md_page_request(
    json_request({ namespace: 7, md: "hello" }),
    publishing,
  );
  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    ok: false,
    error: "invalid_request",
    detail: "namespace must be a string",
  });
});

Deno.test("guest API rejects reserved and invalid locators", async () => {
  const { publishing } = create_legacy_services();
  const reserved = await publish_guest_md_page_request(
    json_request({ namespace: "API", md: "hello" }),
    publishing,
  );
  assertEquals(reserved.status, 403);
  assertEquals((await reserved.json()).error, "forbidden_namespace");

  const invalid = await publish_guest_md_page_request(
    json_request({ namespace: "guest", page_name: "", md: "hello" }),
    publishing,
  );
  assertEquals(invalid.status, 422);
  assertEquals((await invalid.json()).error, "invalid_locator");
});

Deno.test("guest API rejects publishing into a creator-reserved namespace", async () => {
  const { publishing, namespaces } = create_legacy_services();
  const reserved = await namespaces.reserve({
    namespace: "Claimed",
    owner_user_id: "owner-1",
  });
  assertEquals(reserved.ok, true);

  const response = await publish_guest_md_page_request(
    json_request({ namespace: "claimed", md: "# Takeover" }),
    publishing,
  );
  assertEquals(response.status, 403);
  assertEquals(await response.json(), {
    ok: false,
    error: "namespace_reserved",
    detail: "namespace is reserved by a creator",
  });
});

Deno.test("session-derived actor lets the owner publish into its reserved namespace", async () => {
  const { publishing, namespaces } = create_legacy_services();
  const reserved = await namespaces.reserve({
    namespace: "Claimed",
    owner_user_id: "owner-1",
  });
  assertEquals(reserved.ok, true);

  const owner = await publish_guest_md_page_request(
    json_request({ namespace: "claimed", md: "# Mine" }),
    publishing,
    { kind: "user", user_id: "owner-1" },
  );
  assertEquals(owner.status, 201);

  const other = await publish_guest_md_page_request(
    json_request({ namespace: "claimed", md: "# Takeover" }),
    publishing,
    { kind: "user", user_id: "owner-2" },
  );
  assertEquals(other.status, 403);
  assertEquals((await other.json()).error, "namespace_reserved");
});

Deno.test("publish actors derive from the request session kind", () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const guest_session: Session = {
    kind: "guest",
    session_id: "session-1",
    session_version: 1,
    created_at: now,
    last_seen_at: now,
    absolute_expires_at: new Date("2026-07-25T12:00:00.000Z"),
  };
  assertEquals(publish_actor_from_session(guest_session), { kind: "guest" });
  assertEquals(
    publish_actor_from_session({
      ...guest_session,
      kind: "authenticated",
      user_id: "user-1",
      authenticated_at: now,
      idle_expires_at: new Date("2026-08-17T12:00:00.000Z"),
      csrf_token: "c".repeat(43),
    }),
    { kind: "user", user_id: "user-1" },
  );
});

Deno.test("guest API surfaces MdPage validation", async () => {
  const { publishing } = create_legacy_services();
  const response = await publish_guest_md_page_request(
    json_request({ namespace: "guest", md: "" }),
    publishing,
  );
  assertEquals(response.status, 422);
  assertEquals(await response.json(), {
    ok: false,
    error: "invalid_input",
    detail: "md must be a non-empty string",
  });
});

Deno.test("guest API bounds request buffering", async () => {
  const { publishing } = create_legacy_services();
  const response = await publish_guest_md_page_request(
    new Request("https://pager.test/api/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(guest_publish_request_max_bytes + 1),
    }),
    publishing,
  );
  assertEquals(response.status, 413);
  assertEquals((await response.json()).error, "request_too_large");
});

Deno.test("guest API enforces MdPage content limits", async () => {
  const { publishing } = create_legacy_services();
  const response = await publish_guest_md_page_request(
    json_request({
      namespace: "guest",
      md: "x".repeat(64 * 1024 + 1),
    }),
    publishing,
  );
  assertEquals(response.status, 422);
  assertEquals((await response.json()).detail, "md exceeds 65536 bytes");
});
