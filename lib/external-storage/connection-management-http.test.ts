import { assert, assertEquals } from "@std/assert";
import { create_app_services } from "../app.ts";
import type { AuthenticatedSession, Session } from "../session/model.ts";
import { MemoryStorageConnectionRepository } from "./memory-connection-repository.ts";
import { MemoryExternalStorageProvider } from "./memory-provider.ts";

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
const guest: Session = {
  kind: "guest",
  session_id: "guest-1",
  session_version: 1,
  created_at: now,
  last_seen_at: now,
  absolute_expires_at: new Date("2026-07-29T12:00:00.000Z"),
};

Deno.test("storage connection API lists only owner-safe metadata", async () => {
  const connections = new MemoryStorageConnectionRepository();
  const services = create_app_services({
    storage_connection_repository: connections,
    external_storage_providers: [
      new MemoryExternalStorageProvider("google-drive"),
    ],
  });
  assert(
    (await connections.create({
      connection_id: "connection-1",
      user_id: session.user_id,
      provider_id: "google-drive",
      provider_subject: "owner@example.test",
      scopes: ["drive.file"],
      status: "active",
      created_at: now,
      updated_at: now,
    })).ok,
  );
  assert(
    await connections.put_credentials("connection-1", {
      access_token: "secret-access-token",
      refresh_token: "secret-refresh-token",
    }),
  );

  const response = await services.storage_connections_http.list(
    new Request("https://pager.test/api/storage-connections"),
    { request_id: "list", session },
  );
  assertEquals(response.status, 200);
  const text = await response.text();
  assertEquals(text.includes("secret-access-token"), false);
  assertEquals(text.includes("secret-refresh-token"), false);
  const body = JSON.parse(text);
  assertEquals(body.connections[0], {
    connection_id: "connection-1",
    provider_id: "google-drive",
    provider_label: "Google Drive",
    provider_subject: "owner@example.test",
    scopes: ["drive.file"],
    status: "active",
    capabilities: ["read", "write", "delete"],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });

  const disconnected = await services.storage_connections_http.disconnect(
    new Request("https://pager.test/api/storage-connections/google-drive", {
      method: "DELETE",
      headers: { "x-csrf-token": session.csrf_token },
    }),
    { request_id: "disconnect", session },
    "google-drive",
  );
  assertEquals(disconnected.status, 200);
  assertEquals(await connections.get_credentials("connection-1"), null);
  assertEquals(
    (await connections.find_by_id("connection-1"))?.status,
    "revoked",
  );
});

Deno.test("storage connection API is browser-owned and CSRF-protected", async () => {
  const services = create_app_services();
  const guest_response = await services.storage_connections_http.list(
    new Request("https://pager.test/api/storage-connections"),
    { request_id: "guest", session: guest },
  );
  assertEquals(guest_response.status, 401);
  const bearer_response = await services.storage_connections_http.list(
    new Request("https://pager.test/api/storage-connections", {
      headers: { authorization: "Bearer invalid" },
    }),
    { request_id: "bearer", session },
  );
  assertEquals(bearer_response.status, 401);

  const denied = await services.storage_connections_http.connect(
    new Request("https://pager.test/api/storage-connections/google-drive", {
      method: "POST",
    }),
    { request_id: "connect", session },
    "google-drive",
  );
  assertEquals(denied.status, 403);
  const started = await services.storage_connections_http.connect(
    new Request("https://pager.test/api/storage-connections/google-drive", {
      method: "POST",
      headers: { "x-csrf-token": session.csrf_token },
    }),
    { request_id: "connect", session },
    "google-drive",
  );
  assertEquals(started.status, 303);
  assertEquals(
    started.headers.get("location"),
    "/auth/storage/google-drive/start",
  );
});
