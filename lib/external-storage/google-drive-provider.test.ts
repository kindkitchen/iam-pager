import { assert, assertEquals, assertExists } from "@std/assert";
import type { StorageConnectionCredentials } from "./connection-model.ts";
import { FakeGoogleDriveServer } from "./google-drive-fake-server.ts";
import { FetchGoogleDriveGateway } from "./google-drive-gateway.ts";
import { GoogleDriveExternalStorageProvider } from "./google-drive-provider.ts";
import { MemoryStorageConnectionRepository } from "./memory-connection-repository.ts";
import type { ExternalContentRef } from "./model.ts";
import { test_external_storage_provider_conformance } from "./provider-conformance.ts";

const now = new Date("2026-07-22T12:00:00.000Z");

async function fixture(options: {
  credentials?: StorageConnectionCredentials;
  fetcher_factory?: (server: FakeGoogleDriveServer) => typeof fetch;
} = {}) {
  const server = new FakeGoogleDriveServer();
  const repository = new MemoryStorageConnectionRepository();
  const connection = {
    connection_id: "connection-1",
    user_id: "user-1",
    provider_id: "google-drive",
    provider_subject: "drive-user-1",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    status: "active" as const,
    created_at: now,
    updated_at: now,
  };
  assert((await repository.create(connection)).ok);
  const credentials = options.credentials ?? {
    access_token: "access-1",
    refresh_token: "refresh-1",
  };
  assert(
    await repository.put_credentials(connection.connection_id, credentials),
  );
  server.authorize_access_token(credentials.access_token);
  const gateway = new FetchGoogleDriveGateway({
    client_id: "drive-client",
    client_secret: "drive-secret",
    fetcher: options.fetcher_factory?.(server) ?? server.fetch,
    drive_api_base_url: server.drive_api_base_url,
    drive_upload_base_url: server.drive_upload_base_url,
    token_url: server.token_url,
    now: () => now,
  });
  return {
    server,
    repository,
    provider: new GoogleDriveExternalStorageProvider({
      connections: repository,
      gateway,
      clock: { now: () => now },
    }),
  };
}

function ref(external_ref: string, version_hint?: string): ExternalContentRef {
  return {
    provider_id: "google-drive",
    connection_id: "connection-1",
    external_ref,
    ...(version_hint === undefined ? {} : { version_hint }),
  };
}

test_external_storage_provider_conformance({
  name: "GoogleDriveExternalStorageProvider",
  make_fixture: async () => {
    const result = await fixture();
    const existing_body = new Uint8Array([1, 2, 3, 4]);
    const checksum = await result.server.seed_file({
      file_id: "existing",
      body: existing_body,
    });
    result.server.set_failure("unreachable", { status: 503 });
    return {
      provider: result.provider,
      existing_ref: ref("existing", checksum),
      existing_body,
      missing_ref: ref("missing"),
      unreachable_ref: ref("unreachable"),
      put_input: {
        connection_id: "connection-1",
        body: new Uint8Array([5, 6, 7]),
        media_type: "application/octet-stream",
        download_filename: "content.bin",
      },
    };
  },
});

Deno.test("Drive provider treats trashed, denied, changed, and gone files as missing", async () => {
  const { provider, server } = await fixture();
  const checksum = await server.seed_file({
    file_id: "trashed",
    body: new Uint8Array([1]),
    trashed: true,
  });
  await server.seed_file({ file_id: "denied", body: new Uint8Array([2]) });
  server.set_failure("denied", {
    status: 403,
    reason: "insufficientFilePermissions",
  });
  server.set_failure("gone", { status: 410 });

  for (
    const content_ref of [
      ref("trashed", checksum),
      ref("denied"),
      ref("gone"),
      ref("trashed", "different-checksum"),
    ]
  ) {
    assertEquals(await provider.stat_content(content_ref), {
      ok: false,
      reason: "external_content_missing",
    });
  }
});

Deno.test("Drive provider preserves safe retry hints for retryable responses", async () => {
  const { provider, server } = await fixture();
  server.set_failure("rate-limited", {
    status: 429,
    retry_after_seconds: 30,
  });
  server.set_failure("quota", {
    status: 403,
    reason: "userRateLimitExceeded",
  });
  assertEquals(await provider.stat_content(ref("rate-limited")), {
    ok: false,
    reason: "external_source_unreachable",
    retry_after_seconds: 30,
  });
  assertEquals(await provider.stat_content(ref("quota")), {
    ok: false,
    reason: "external_source_unreachable",
  });
});

Deno.test("Drive provider refreshes expired access once and persists rotation", async () => {
  const credentials = {
    access_token: "expired-access",
    refresh_token: "refresh-1",
    access_token_expires_at: new Date("2026-07-22T11:00:00.000Z"),
  };
  const { provider, repository, server } = await fixture({ credentials });
  server.allow_refresh("refresh-1", {
    access_token: "fresh-access",
    refresh_token: "refresh-2",
  });
  const checksum = await server.seed_file({
    file_id: "existing",
    body: new Uint8Array([1, 2]),
  });

  assertEquals(await provider.stat_content(ref("existing", checksum)), {
    ok: true,
    value: { size_bytes: 2, version_hint: checksum },
  });
  assertEquals(await repository.get_credentials("connection-1"), {
    access_token: "fresh-access",
    refresh_token: "refresh-2",
    access_token_expires_at: new Date("2026-07-22T13:00:00.000Z"),
  });
});

Deno.test("Drive provider refreshes concurrent requests single-flight", async () => {
  const credentials = {
    access_token: "expired-access",
    refresh_token: "refresh-1",
    access_token_expires_at: new Date("2026-07-22T11:00:00.000Z"),
  };
  let refresh_count = 0;
  const { provider, server } = await fixture({
    credentials,
    fetcher_factory: (fake) =>
      (async (input, init) => {
        if (
          new URL(input instanceof Request ? input.url : input).pathname ===
            "/oauth2/token"
        ) {
          refresh_count += 1;
          await Promise.resolve();
        }
        return await fake.fetch(input, init);
      }) as typeof fetch,
  });
  server.allow_refresh("refresh-1", { access_token: "fresh-access" });
  const checksum = await server.seed_file({
    file_id: "existing",
    body: new Uint8Array([1]),
  });

  const results = await Promise.all([
    provider.stat_content(ref("existing", checksum)),
    provider.stat_content(ref("existing", checksum)),
  ]);
  assertEquals(results[0].ok, true);
  assertEquals(results[1].ok, true);
  assertEquals(refresh_count, 1);
});

Deno.test("Drive provider revokes invalid refresh credentials", async () => {
  const credentials = {
    access_token: "expired-access",
    refresh_token: "invalid-refresh",
    access_token_expires_at: new Date("2026-07-22T11:00:00.000Z"),
  };
  const { provider, repository, server } = await fixture({ credentials });
  server.reject_refresh("invalid-refresh");

  assertEquals(await provider.stat_content(ref("file")), {
    ok: false,
    reason: "connection_revoked",
  });
  assertEquals(
    (await repository.find_by_id("connection-1"))?.status,
    "revoked",
  );
  assertEquals(await repository.get_credentials("connection-1"), null);
});

Deno.test("Drive provider revokes a connection when refreshed access is still unauthorized", async () => {
  const { provider, repository, server } = await fixture();
  server.deny_access_token("access-1");
  server.allow_refresh("refresh-1", { access_token: "access-2" });
  server.deny_access_token("access-2");

  assertEquals(await provider.stat_content(ref("file")), {
    ok: false,
    reason: "connection_revoked",
  });
  assertEquals(
    (await repository.find_by_id("connection-1"))?.status,
    "revoked",
  );
});

Deno.test("Drive gateway bounds media bodies and maps transport errors", async () => {
  const server = new FakeGoogleDriveServer();
  server.authorize_access_token("access");
  await server.seed_file({
    file_id: "large",
    body: new Uint8Array([1, 2, 3]),
  });
  const gateway = new FetchGoogleDriveGateway({
    client_id: "client",
    client_secret: "secret",
    fetcher: server.fetch,
    drive_api_base_url: server.drive_api_base_url,
    drive_upload_base_url: server.drive_upload_base_url,
    token_url: server.token_url,
  });
  assertEquals(
    await gateway.fetch_file({
      access_token: "access",
      file_id: "large",
      max_bytes: 2,
    }),
    { ok: false, reason: "missing" },
  );

  const unavailable_gateway = new FetchGoogleDriveGateway({
    client_id: "client",
    client_secret: "secret",
    fetcher: (() => Promise.reject(new Error("offline"))) as typeof fetch,
  });
  assertEquals(
    await unavailable_gateway.stat_file({
      access_token: "access",
      file_id: "file",
    }),
    { ok: false, reason: "unreachable" },
  );
});

Deno.test("Drive upload rejection is unavailable rather than missing", async () => {
  const { provider, server } = await fixture();
  server.set_upload_failure({
    status: 403,
    reason: "storageQuotaExceeded",
  });

  assertEquals(
    await provider.put_content({
      connection_id: "connection-1",
      body: new Uint8Array([7, 8, 9]),
      media_type: "application/pdf",
      download_filename: "report.pdf",
    }),
    { ok: false, reason: "external_source_unreachable" },
  );
});

Deno.test("Drive upload captures returned checksum as the version hint", async () => {
  const { provider } = await fixture();
  const written = await provider.put_content({
    connection_id: "connection-1",
    body: new Uint8Array([7, 8, 9]),
    media_type: "application/pdf",
    download_filename: "report.pdf",
  });
  assert(written.ok);
  assertExists(written.value.version_hint);
  assertEquals(
    await provider.fetch_content({ content_ref: written.value, max_bytes: 3 }),
    {
      ok: true,
      value: {
        body: new Uint8Array([7, 8, 9]),
        stat: { size_bytes: 3, version_hint: written.value.version_hint },
      },
    },
  );
});
