import { assert, assertEquals, assertFalse } from "@std/assert";
import { create_app_services } from "../app.ts";
import {
  MemoryExternalStorageProvider,
  MemoryStorageConnectionRepository,
} from "../external-storage/mod.ts";
import type { AuthenticatedSession } from "../session/model.ts";

const now = new Date("2026-07-22T12:00:00.000Z");
const session: AuthenticatedSession = {
  kind: "authenticated",
  session_id: "session-1",
  session_version: 2,
  user_id: "user-1",
  created_at: now,
  last_seen_at: now,
  authenticated_at: now,
  idle_expires_at: new Date("2026-08-22T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-10-22T12:00:00.000Z"),
  csrf_token: "c".repeat(43),
};

Deno.test("managed publish and replacement can commit verified external assets", async () => {
  const connections = new MemoryStorageConnectionRepository();
  const provider = new MemoryExternalStorageProvider("test-drive");
  const services = create_app_services({
    storage_connection_repository: connections,
    external_storage_providers: [provider],
  });
  assert(
    (await services.namespaces.reserve({
      namespace: "Owner",
      owner_user_id: session.user_id,
    })).ok,
  );
  assert(
    (await connections.create({
      connection_id: "connection-1",
      user_id: session.user_id,
      provider_id: provider.provider_id,
      provider_subject: "owner@example.test",
      scopes: ["content.write"],
      status: "active",
      created_at: now,
      updated_at: now,
    })).ok,
  );

  const published = await services.pages_http.collection(
    new Request("https://pager.test/api/pages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": session.csrf_token,
      },
      body: JSON.stringify({
        locator: { namespace: "Owner", page_name: "external" },
        access: "public",
        content: {
          content_type: "md-page",
          input: { md: "# External" },
          storage: { provider_id: provider.provider_id },
        },
      }),
    }),
    { request_id: "publish", session },
  );
  assertEquals(published.status, 201);
  const published_body = await published.json();
  const page_id = published_body.page.page_id as string;
  const page = await services.page_repository.find_page_aggregate_by_id(
    page_id,
  );
  assert(page !== null);
  const asset = await services.page_repository.find_content_asset_by_id(
    page.content_asset_id,
  );
  assert(asset !== null);
  assertEquals(asset.source.kind, "external");
  assertFalse(Object.hasOwn(asset, "data"));
  assertEquals(asset.meta.codec_version, "md-page-v1");
  assertEquals(asset.meta.sha256?.length, 64);

  const delivered = await services.pages.deliver(
    { namespace: "Owner", page_name: "external" },
    { kind: "guest" },
  );
  assert(delivered.ok);
  assertEquals(typeof delivered.payload.body, "object");
  assert(
    new TextDecoder().decode(delivered.payload.body as Uint8Array).includes(
      "External",
    ),
  );

  const replaced = await services.pages_http.item(
    new Request(`https://pager.test/api/pages/${page_id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": session.csrf_token,
        "if-match": published.headers.get("etag")!,
      },
      body: JSON.stringify({
        content: {
          content_type: "md-page",
          input: { md: "# Replaced" },
          storage: { provider_id: provider.provider_id },
        },
      }),
    }),
    { request_id: "replace", session },
  );
  assertEquals(replaced.status, 200);
  const next_page = await services.page_repository.find_page_aggregate_by_id(
    page_id,
  );
  assert(next_page !== null);
  assertFalse(next_page.content_asset_id === page.content_asset_id);
});

Deno.test("external publication never falls back to inline custody", async () => {
  const services = create_app_services();
  assert(
    (await services.namespaces.reserve({
      namespace: "Owner",
      owner_user_id: session.user_id,
    })).ok,
  );
  const response = await services.pages_http.collection(
    new Request("https://pager.test/api/pages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": session.csrf_token,
      },
      body: JSON.stringify({
        locator: { namespace: "Owner", page_name: "missing-connection" },
        access: "public",
        content: {
          content_type: "md-page",
          input: { md: "# Must stay external" },
          storage: { provider_id: "test-drive" },
        },
      }),
    }),
    { request_id: "publish", session },
  );
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "storage_connection_not_found");
  assertEquals(
    await services.page_repository.resolve_page_endpoint({
      namespace: "Owner",
      page_name: "missing-connection",
    }),
    null,
  );
});
