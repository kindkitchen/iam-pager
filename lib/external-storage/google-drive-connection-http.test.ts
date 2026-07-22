import { assertEquals } from "@std/assert";
import type { AppRequestContext } from "../request-context.ts";
import type { AuthenticatedSession, GuestSession } from "../session/model.ts";
import type {
  GoogleDriveConnectionManager,
  GoogleDriveConnectionResult,
} from "./google-drive-connection-service.ts";
import { GoogleDriveConnectionHttpAdapter } from "./google-drive-connection-http.ts";

const now = new Date("2026-07-22T12:00:00.000Z");
const authenticated_session: AuthenticatedSession = {
  kind: "authenticated",
  session_id: "session-1",
  session_version: 1,
  user_id: "user-1",
  csrf_token: "c".repeat(43),
  created_at: now,
  last_seen_at: now,
  authenticated_at: now,
  idle_expires_at: new Date("2026-08-22T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-10-22T12:00:00.000Z"),
};
const guest_session: GuestSession = {
  kind: "guest",
  session_id: "guest-1",
  session_version: 1,
  created_at: now,
  last_seen_at: now,
  absolute_expires_at: new Date("2026-07-29T12:00:00.000Z"),
};

class FakeManager implements GoogleDriveConnectionManager {
  readonly calls: string[] = [];

  start(): Promise<GoogleDriveConnectionResult<{ authorization_url: string }>> {
    this.calls.push("start");
    return Promise.resolve({
      ok: true,
      value: { authorization_url: "https://consent.example/" },
    });
  }

  complete(
    _session: AuthenticatedSession,
    state: string,
    code: string,
  ): Promise<GoogleDriveConnectionResult<never>> {
    this.calls.push(`complete:${state}:${code}`);
    return Promise.resolve({ ok: false, reason: "invalid_attempt" });
  }

  disconnect(): Promise<GoogleDriveConnectionResult<never>> {
    this.calls.push("disconnect");
    return Promise.resolve({ ok: false, reason: "invalid_attempt" });
  }
}

function context(
  session: AuthenticatedSession | GuestSession,
): AppRequestContext {
  return { request_id: "request-1", session };
}

Deno.test("Drive HTTP start and callback reject unauthenticated sessions", async () => {
  const manager = new FakeManager();
  const handler = new GoogleDriveConnectionHttpAdapter({
    connections: manager,
  });
  assertEquals(
    (await handler.start(
      new Request("https://pager.example/auth/storage/google-drive/start"),
      context(guest_session),
    )).status,
    401,
  );
  assertEquals(
    (await handler.callback(
      new Request(
        `https://pager.example/auth/storage/google-drive/callback?state=${
          "s".repeat(43)
        }&code=code`,
      ),
      context(guest_session),
    )).status,
    401,
  );
  assertEquals(manager.calls, []);
});

Deno.test("Drive HTTP callback rejects state mismatch through the owner-safe page", async () => {
  const manager = new FakeManager();
  const handler = new GoogleDriveConnectionHttpAdapter({
    connections: manager,
  });
  const state = "s".repeat(43);
  const response = await handler.callback(
    new Request(
      `https://pager.example/auth/storage/google-drive/callback?state=${state}&code=code`,
    ),
    context(authenticated_session),
  );
  assertEquals(response.status, 400);
  assertEquals(
    response.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  assertEquals(
    (await response.text()).includes("Google Drive connection failed"),
    true,
  );
  assertEquals(manager.calls, [`complete:${state}:code`]);
});

Deno.test("Drive HTTP disconnect enforces synchronizer CSRF", async () => {
  const manager = new FakeManager();
  const handler = new GoogleDriveConnectionHttpAdapter({
    connections: manager,
  });
  const request = (csrf_token: string) =>
    new Request(
      "https://pager.example/auth/storage/google-drive/disconnect",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf_token }),
      },
    );
  assertEquals(
    (await handler.disconnect(
      request("x".repeat(43)),
      context(authenticated_session),
    )).status,
    403,
  );
  assertEquals(manager.calls, []);
  assertEquals(
    (await handler.disconnect(
      request(authenticated_session.csrf_token),
      context(authenticated_session),
    )).status,
    404,
  );
  assertEquals(manager.calls, ["disconnect"]);
});
