import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { StorageConnectionsPanel } from "../../components/StorageConnectionsPanel.tsx";
import type { StorageConnectionManagement } from "../external-storage/connection-management.ts";
import type { Session } from "../session/model.ts";
import { CreatorStorageConnectionPanelPresenter } from "./storage-connections.ts";

const now = new Date("2026-07-22T12:00:00.000Z");
const session: Session = {
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

Deno.test("storage presenter offers only active write-capable connections", async () => {
  const management: StorageConnectionManagement = {
    connect_options: () => [{
      provider_id: "google-drive",
      label: "Google Drive",
      action: "/auth/storage/google-drive/start",
    }],
    connect_path: () => "/auth/storage/google-drive/start",
    disconnect: () => Promise.resolve({ ok: true }),
    list_owned: () =>
      Promise.resolve([
        {
          connection_id: "connection-1",
          provider_id: "google-drive",
          provider_label: "Google Drive",
          provider_subject: "owner@example.test",
          scopes: ["drive.file"],
          status: "active",
          capabilities: ["read", "write"],
          created_at: now,
          updated_at: now,
        },
        {
          connection_id: "connection-2",
          provider_id: "archive",
          provider_label: "Archive",
          provider_subject: "owner",
          scopes: ["read"],
          status: "active",
          capabilities: ["read"],
          created_at: now,
          updated_at: now,
        },
      ]),
  };
  const panel = await new CreatorStorageConnectionPanelPresenter(management)
    .present(session);
  assertEquals(panel.kind, "creator");
  if (panel.kind !== "creator") return;
  assertEquals(panel.writable_options, [{
    provider_id: "google-drive",
    label: "Google Drive",
  }]);
  const html = render_to_string(<StorageConnectionsPanel panel={panel} />);
  assertStringIncludes(html, "Connected storages");
  assertStringIncludes(html, "owner@example.test");
  assertStringIncludes(html, "Disconnect");
  assertStringIncludes(html, "Reconnect Google Drive");
  assertStringIncludes(html, "dependent pages");
});
