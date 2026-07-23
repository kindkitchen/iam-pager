import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedSession } from "../session/model.ts";
import { MemoryStorageConnectionRepository } from "./memory-connection-repository.ts";
import {
  GoogleDriveConnectionService,
} from "./google-drive-connection-service.ts";
import {
  google_drive_file_scope,
  type GoogleDriveOAuthClient,
  type GoogleDriveOAuthGrant,
  type GoogleDriveOAuthResult,
} from "./google-drive-oauth.ts";
import { MemoryStorageOAuthAttemptRepository } from "./storage-oauth-attempt-repository.ts";

function session(
  overrides: Partial<AuthenticatedSession> = {},
): AuthenticatedSession {
  const now = new Date("2026-07-22T10:00:00.000Z");
  return {
    kind: "authenticated",
    session_id: "session-1",
    session_version: 1,
    user_id: "user-1",
    csrf_token: "c".repeat(43),
    created_at: now,
    last_seen_at: now,
    authenticated_at: now,
    idle_expires_at: new Date("2026-08-22T10:00:00.000Z"),
    absolute_expires_at: new Date("2026-10-22T10:00:00.000Z"),
    ...overrides,
  };
}

class FakeOAuth implements GoogleDriveOAuthClient {
  grant: GoogleDriveOAuthGrant = {
    provider_subject: "drive-subject-1",
    scopes: [google_drive_file_scope],
    credentials: {
      access_token: "access-1",
      refresh_token: "refresh-1",
    },
  };
  readonly callback_inputs: unknown[] = [];
  readonly revoked_tokens: string[] = [];
  fail_revoke = false;

  begin(input: { state: string; callback_url: string }): Promise<
    GoogleDriveOAuthResult<{
      authorization_url: string;
      attempt_context: string;
    }>
  > {
    return Promise.resolve({
      ok: true,
      value: {
        authorization_url: `https://consent.example/?state=${input.state}`,
        attempt_context: "pkce-verifier",
      },
    });
  }

  complete(
    input: unknown,
  ): Promise<GoogleDriveOAuthResult<GoogleDriveOAuthGrant>> {
    this.callback_inputs.push(input);
    return Promise.resolve({ ok: true, value: this.grant });
  }

  revoke(
    credentials: { access_token: string; refresh_token?: string },
  ): Promise<void> {
    this.revoked_tokens.push(
      credentials.refresh_token ?? credentials.access_token,
    );
    return this.fail_revoke
      ? Promise.reject(new Error("provider unavailable"))
      : Promise.resolve();
  }
}

function fixture() {
  const oauth = new FakeOAuth();
  const repository = new MemoryStorageConnectionRepository();
  let id = 0;
  const service = new GoogleDriveConnectionService({
    oauth,
    connections: repository,
    attempts: new MemoryStorageOAuthAttemptRepository(),
    state_generator: { generate: () => "s".repeat(43) },
    connection_id_generator: { generate: () => `connection-${++id}` },
    clock: { now: () => new Date("2026-07-22T10:00:00.000Z") },
  });
  return { oauth, repository, service };
}

Deno.test("Drive connection state is authenticated-session-bound and one-use", async () => {
  const { oauth, repository, service } = fixture();
  const started = await service.start(
    session(),
    "https://pager.example/auth/storage/google-drive/callback",
  );
  assert(started.ok);
  assertEquals(
    await service.complete(
      session({ session_id: "other-session" }),
      "s".repeat(43),
      "code",
    ),
    { ok: false, reason: "invalid_attempt" },
  );

  const completed = await service.complete(session(), "s".repeat(43), "code");
  assert(completed.ok);
  assertEquals(completed.value.connection.user_id, "user-1");
  assertEquals(completed.value.connection.provider_id, "google-drive");
  assertEquals(
    await repository.get_credentials(
      completed.value.connection.connection_id,
    ),
    { access_token: "access-1", refresh_token: "refresh-1" },
  );
  assertEquals(oauth.callback_inputs, [{
    code: "code",
    callback_url: "https://pager.example/auth/storage/google-drive/callback",
    attempt_context: "pkce-verifier",
  }]);
  assertEquals(await service.complete(session(), "s".repeat(43), "code"), {
    ok: false,
    reason: "invalid_attempt",
  });
});

Deno.test("Drive callback consumes malformed attempts before provider exchange", async () => {
  const { oauth, service } = fixture();
  await service.start(
    session(),
    "https://pager.example/auth/storage/google-drive/callback",
  );

  assertEquals(await service.complete(session(), "s".repeat(43), ""), {
    ok: false,
    reason: "invalid_attempt",
  });
  assertEquals(oauth.callback_inputs, []);
  assertEquals(await service.complete(session(), "s".repeat(43), "code"), {
    ok: false,
    reason: "invalid_attempt",
  });
});

Deno.test("Drive reauthorization keeps a refresh token omitted by Google", async () => {
  const { oauth, repository, service } = fixture();
  await service.start(
    session(),
    "https://pager.example/auth/storage/google-drive/callback",
  );
  const first = await service.complete(session(), "s".repeat(43), "code-1");
  assert(first.ok);

  oauth.grant = {
    ...oauth.grant,
    credentials: { access_token: "access-2" },
  };
  await service.start(
    session(),
    "https://pager.example/auth/storage/google-drive/callback",
  );
  const second = await service.complete(session(), "s".repeat(43), "code-2");
  assert(second.ok);
  assertEquals(
    second.value.connection.connection_id,
    first.value.connection.connection_id,
  );
  assertEquals(
    await repository.get_credentials(
      first.value.connection.connection_id,
    ),
    { access_token: "access-2", refresh_token: "refresh-1" },
  );
});

Deno.test("Drive disconnect destroys local credentials when provider revocation fails", async () => {
  const { oauth, repository, service } = fixture();
  await service.start(
    session(),
    "https://pager.example/auth/storage/google-drive/callback",
  );
  const connected = await service.complete(session(), "s".repeat(43), "code");
  assert(connected.ok);
  oauth.fail_revoke = true;

  const disconnected = await service.disconnect(session());
  assert(disconnected.ok);
  assertEquals(disconnected.value.connection.status, "revoked");
  assertEquals(oauth.revoked_tokens, ["refresh-1"]);
  assertEquals(
    await repository.get_credentials(
      connected.value.connection.connection_id,
    ),
    null,
  );
});
