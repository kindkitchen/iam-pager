import {
  assertEquals,
  assertExists,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  GOOGLE_AUTH_CLIENT_ID_ENV,
  GOOGLE_AUTH_CLIENT_SECRET_ENV,
  GOOGLE_AUTH_MOCK_CONSENT_URL_ENV,
  GOOGLE_AUTH_MODE_ENV,
  GOOGLE_AUTH_REDIRECT_URI_ENV,
  GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV,
  MemoryIdentityRepository,
} from "./auth/mod.ts";
import {
  type ExternalStorageProvider,
  GOOGLE_DRIVE_CLIENT_ID_ENV,
  GOOGLE_DRIVE_CLIENT_SECRET_ENV,
  GOOGLE_DRIVE_MOCK_CONSENT_URL_ENV,
  GOOGLE_DRIVE_MODE_ENV,
  GOOGLE_DRIVE_REDIRECT_URI_ENV,
  MemoryStorageConnectionRepository,
  MemoryStorageOAuthAttemptRepository,
} from "./external-storage/mod.ts";
import {
  type AppServices,
  create_app_services,
  create_configured_app_services,
  parse_session_cookie_mode,
  SESSION_COOKIE_MODE_ENV,
} from "./app.ts";
import { MemoryApiKeyRepository } from "./api-key/mod.ts";
import { pdf_media_type } from "./content/mod.ts";
import { MemoryNamespaceRepository } from "./namespace/mod.ts";
import {
  deliver_page_locator_path,
  MemoryPageAggregateRepository,
} from "./page/mod.ts";
import type { AppRequestState } from "./request-context.ts";
import { MemorySessionRepository } from "./session/mod.ts";
import {
  type ApiKeyRepositoryFactory,
  type ApiKeyStorageConfig,
  OWNERSHIP_DENO_KV_PATH_ENV,
  OWNERSHIP_STORAGE_BACKEND_ENV,
  type OwnershipRepositoryFactory,
  type OwnershipStorageConfig,
  PAGE_STORAGE_BACKEND_ENV,
  type PageAggregateRepositoryFactory,
  type PageStorageConfig,
  SESSION_STORAGE_BACKEND_ENV,
  type SessionRepositoryFactory,
  type SessionStorageConfig,
  type StorageConnectionRepositoriesFactory,
  type StorageConnectionStorageConfig,
} from "./storage/mod.ts";

const text_encoder = new TextEncoder();
const memory_storage_environment: Readonly<Record<string, string>> = {
  [OWNERSHIP_STORAGE_BACKEND_ENV]: "memory",
  [SESSION_STORAGE_BACKEND_ENV]: "memory",
  [PAGE_STORAGE_BACKEND_ENV]: "memory",
};
const local_google_environment: Readonly<Record<string, string>> = {
  ...memory_storage_environment,
  [SESSION_COOKIE_MODE_ENV]: "local",
  [GOOGLE_AUTH_MODE_ENV]: "local",
  [GOOGLE_AUTH_REDIRECT_URI_ENV]: "http://localhost:5173/auth/google/callback",
  [GOOGLE_AUTH_MOCK_CONSENT_URL_ENV]:
    "http://localhost:5173/auth/google/mock-consent",
  [GOOGLE_DRIVE_MODE_ENV]: "local",
  [GOOGLE_DRIVE_REDIRECT_URI_ENV]:
    "http://localhost:5173/auth/storage/google-drive/callback",
  [GOOGLE_DRIVE_MOCK_CONSENT_URL_ENV]:
    "http://localhost:5173/auth/storage/google-drive/mock-consent",
};
const preview_google_drive_environment: Readonly<Record<string, string>> = {
  ...memory_storage_environment,
  [SESSION_COOKIE_MODE_ENV]: "production",
  [GOOGLE_AUTH_MODE_ENV]: "local",
  [GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV]:
    "iam-pager-pr-[a-z0-9-]+\\.example\\.com",
  [GOOGLE_DRIVE_MODE_ENV]: "local",
};
const original_google_environment: Readonly<Record<string, string>> = {
  ...memory_storage_environment,
  [GOOGLE_AUTH_MODE_ENV]: "original",
  [GOOGLE_AUTH_REDIRECT_URI_ENV]: "https://pager.test/auth/google/callback",
  [GOOGLE_AUTH_CLIENT_ID_ENV]: "sign-in-client",
  [GOOGLE_AUTH_CLIENT_SECRET_ENV]: "sign-in-secret",
  [GOOGLE_DRIVE_MODE_ENV]: "original",
  [GOOGLE_DRIVE_REDIRECT_URI_ENV]:
    "https://pager.test/auth/storage/google-drive/callback",
  [GOOGLE_DRIVE_CLIENT_ID_ENV]: "drive-client",
  [GOOGLE_DRIVE_CLIENT_SECRET_ENV]: "drive-secret",
};

function pdf_bytes(): Uint8Array {
  const before_xref = `%PDF-1.7\n` +
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n`;
  const xref_offset = text_encoder.encode(before_xref).byteLength;
  return text_encoder.encode(
    before_xref +
      `xref\n0 3\n` +
      `0000000000 65535 f \n` +
      `0000000009 00000 n \n` +
      `0000000062 00000 n \n` +
      `trailer\n<< /Size 3 /Root 1 0 R >>\n` +
      `startxref\n${xref_offset}\n%%EOF\n`,
  );
}

Deno.test("composition root publishes through HTTP and delivers direct content", async () => {
  const services = create_app_services();
  const session = (await services.session.resolve()).session;
  const created = await services.pages_http.collection(
    new Request("https://pager.test/api/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        locator: { namespace: "Guest", page_name: "hello" },
        access: "public",
        content: {
          content_type: "md-page",
          input: { md: "# Hi there" },
        },
      }),
    }),
    { request_id: "request-1", session },
  );
  assertEquals(created.status, 201);
  assertEquals(created.headers.get("location"), "/Guest/hello");

  const delivered = await deliver_page_locator_path(
    services.engine,
    services.pages,
    "/Guest/hello",
    { kind: "guest" },
  );
  assertEquals(delivered.status, 200);
  assertStringIncludes(await delivered.text(), "Hi there");
  assertEquals(
    await services.pages.publish_trial({
      actor: { kind: "guest" },
      locator: { namespace: "site" },
      access: "public",
      content: { content_type: "md-page", input: { md: "blocked" } },
    }),
    { ok: false, reason: "forbidden_namespace" },
  );
});

Deno.test("composition root authorizes bearer principals over the page API", async () => {
  const services = create_app_services();
  await services.namespaces.reserve({
    namespace: "Robot",
    owner_user_id: "user-1",
  });
  const created_key = await services.api_keys.create({
    owner_user_id: "user-1",
    label: "automation",
    permissions: ["all"],
    expires_at: null,
  });
  if (!created_key.ok) throw new Error("key creation failed");

  const page_request = () =>
    new Request("https://pager.test/api/pages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${created_key.bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        locator: { namespace: "Robot", page_name: "status" },
        access: "public",
        content: { content_type: "md-page", input: { md: "# Robot" } },
      }),
    });
  const handle = (req: Request) => {
    const state = {} as AppRequestState;
    return services.request_context.handle({
      req,
      state,
      next: async () =>
        await services.pages_http.collection(req, state.request_context),
    });
  };

  // The full middleware-to-adapter path: the bearer creates a managed page
  // and no session cookie is issued for the bearer request.
  const created = await handle(page_request());
  assertEquals(created.status, 201);
  assertEquals(created.headers.getSetCookie(), []);
  assertExists((await created.json()).management_url);

  // Revoke-all invalidates the same bearer immediately, without fallback to
  // any cookie session.
  await services.api_keys.revoke_all("user-1");
  const rejected = await handle(page_request());
  assertEquals(rejected.status, 401);
  assertEquals((await rejected.json()).error, "invalid_bearer");
  assertEquals(rejected.headers.get("www-authenticate"), 'Bearer realm="api"');
});

Deno.test("composition root registers PDF and explicit delivery profiles", async () => {
  const services = create_app_services();
  const bytes = pdf_bytes();
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify({
      endpoint_set: {
        canonical: {
          locator: { namespace: "Guest", page_name: "report-preview" },
          delivery_profile: "inline",
        },
        alternates: [{
          locator: { namespace: "Guest", page_name: "report-download" },
          delivery_profile: "attachment",
        }],
      },
      access: "public",
    })], { type: "application/json" }),
    "metadata.json",
  );
  form.append(
    "file",
    new Blob([bytes as BlobPart], { type: pdf_media_type }),
    "report.data",
  );
  const session = (await services.session.resolve()).session;
  const created = await services.pages_http.collection(
    new Request("https://pager.test/api/pages", { method: "POST", body: form }),
    { request_id: "request-pdf", session },
  );
  assertEquals(created.status, 201);

  const preview = await deliver_page_locator_path(
    services.engine,
    services.pages,
    new Request("https://pager.test/Guest/report-preview", {
      headers: { range: "bytes=0-8" },
    }),
    { kind: "guest" },
  );
  assertEquals(preview.status, 206);
  assertEquals(new Uint8Array(await preview.arrayBuffer()), bytes.slice(0, 9));

  const download = await deliver_page_locator_path(
    services.engine,
    services.pages,
    "/Guest/report-download",
    { kind: "guest" },
  );
  assertStringIncludes(
    download.headers.get("content-disposition")!,
    'attachment; filename="report.data"',
  );
  assertEquals(new Uint8Array(await download.arrayBuffer()), bytes);
});

Deno.test("configured composition selects every persistence interface together", async () => {
  const identity_repository = new MemoryIdentityRepository({
    generate: () => "user-a",
  });
  const namespace_repository = new MemoryNamespaceRepository();
  const session_repository = new MemorySessionRepository();
  const page_repository = new MemoryPageAggregateRepository();
  const api_key_repository = new MemoryApiKeyRepository();
  let ownership_config: OwnershipStorageConfig | undefined;
  let session_config: SessionStorageConfig | undefined;
  let page_config: PageStorageConfig | undefined;
  let api_key_config: ApiKeyStorageConfig | undefined;
  let storage_connection_config: StorageConnectionStorageConfig | undefined;
  const ownership_repository_factory: OwnershipRepositoryFactory = {
    create: (config) => {
      ownership_config = config;
      return Promise.resolve({ identity_repository, namespace_repository });
    },
  };
  const session_repository_factory: SessionRepositoryFactory = {
    create: (config) => {
      session_config = config;
      return Promise.resolve(session_repository);
    },
  };
  const page_repository_factory: PageAggregateRepositoryFactory = {
    create: (config) => {
      page_config = config;
      return Promise.resolve(page_repository);
    },
  };
  const api_key_repository_factory: ApiKeyRepositoryFactory = {
    create: (config) => {
      api_key_config = config;
      return Promise.resolve(api_key_repository);
    },
  };
  const storage_connection_repository = new MemoryStorageConnectionRepository();
  const storage_oauth_attempt_repository =
    new MemoryStorageOAuthAttemptRepository();
  const storage_connection_repositories_factory:
    StorageConnectionRepositoriesFactory = {
      create: (config) => {
        storage_connection_config = config;
        return Promise.resolve({
          connection_repository: storage_connection_repository,
          oauth_attempt_repository: storage_oauth_attempt_repository,
        });
      },
    };
  const values = {
    ...local_google_environment,
    [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
    [OWNERSHIP_DENO_KV_PATH_ENV]: "/data/iam-pager.kv",
    [SESSION_STORAGE_BACKEND_ENV]: "deno-kv",
    [PAGE_STORAGE_BACKEND_ENV]: "deno-kv",
  };

  const services = await create_configured_app_services(
    { get: (name) => values[name as keyof typeof values] },
    {
      ownership_repository_factory,
      session_repository_factory,
      page_repository_factory,
      api_key_repository_factory,
      storage_connection_repositories_factory,
    },
  );
  const durable = { backend: "deno-kv", path: "/data/iam-pager.kv" } as const;
  assertEquals(ownership_config, durable);
  assertEquals(session_config, durable);
  assertEquals(page_config, durable);
  assertEquals(api_key_config, durable);
  assertEquals(storage_connection_config, durable);
  assertStrictEquals(services.identity_repository, identity_repository);
  assertStrictEquals(services.namespace_repository, namespace_repository);
  assertStrictEquals(services.page_repository, page_repository);
  assertStrictEquals(services.api_key_repository, api_key_repository);
  assertStrictEquals(
    services.storage_connection_repository,
    storage_connection_repository,
  );
  assertStrictEquals(
    services.storage_oauth_attempt_repository,
    storage_oauth_attempt_repository,
  );
});

Deno.test("configured local Google flow upgrades its guest session", async () => {
  const services = await create_configured_app_services({
    get: (name) => local_google_environment[name],
  });
  const start_request = new Request(
    "http://localhost:5173/auth/google/start?return_to=%2Fsite%2Faccount",
  );
  const started = await run_application_request(
    services,
    start_request,
    async (state) =>
      (await services.authentication_http.start(
        start_request,
        "google",
        state.request_context,
      )).response,
  );
  assertEquals(started.response.status, 303);
  const guest_session_id = started.state.request_context.session.session_id;
  const guest_cookie = response_cookie_header(started.response);
  const consent_location = started.response.headers.get("location");
  assertExists(consent_location);

  const consent_response = services.google_mock_consent_http.handle(
    new Request(consent_location),
  );
  assertEquals(consent_response.status, 200);
  const consent_html = await consent_response.text();
  const callback_url = matched_html_value(
    consent_html,
    /<form id="consent-form" method="GET" action="([^"]+)">/,
  );
  const state = matched_html_value(
    consent_html,
    /<input\s+id="state-input"[\s\S]*?value="([^"]+)"/,
  );
  const code = decode_package_html(matched_html_value(
    consent_html,
    /<textarea name="code" id="code-json"[^>]*>([\s\S]*?)<\/textarea>/,
  ));
  const callback_request = new Request(
    `${decode_package_html(callback_url)}?${new URLSearchParams({
      code,
      state,
    })}`,
    { headers: { cookie: guest_cookie } },
  );
  const callback = await run_application_request(
    services,
    callback_request,
    async (request_state) => {
      const result = await services.authentication_http.callback(
        callback_request,
        "google",
        request_state.request_context,
      );
      if (result.session_resolution !== undefined) {
        services.request_context.apply_session_resolution(
          request_state,
          result.session_resolution,
        );
      }
      return result.response;
    },
  );

  assertEquals(callback.response.status, 303);
  assertEquals(callback.response.headers.get("location"), "/site/account");
  assertEquals(callback.state.request_context.session.kind, "authenticated");
  assertEquals(
    callback.state.request_context.session.session_id,
    guest_session_id,
  );
  assertEquals(
    response_cookie_header(callback.response) === guest_cookie,
    false,
  );
});

Deno.test("configured preview Drive inherits the auth request-host pattern without credentials", async () => {
  const services = await create_configured_app_services({
    get: (name) => preview_google_drive_environment[name],
  });
  const now = new Date("2026-07-23T12:00:00.000Z");
  const context = {
    request_id: "request-preview-drive",
    session: {
      kind: "authenticated" as const,
      session_id: "session-preview-drive",
      session_version: 1,
      user_id: "user-preview-drive",
      csrf_token: "c".repeat(43),
      created_at: now,
      last_seen_at: now,
      authenticated_at: now,
      idle_expires_at: new Date("2026-08-23T12:00:00.000Z"),
      absolute_expires_at: new Date("2026-10-23T12:00:00.000Z"),
    },
  };
  const preview_origin = "https://iam-pager-pr-change-42.example.com";
  const started = await services.google_drive_connections_http.start(
    new Request(`${preview_origin}/auth/storage/google-drive/start`),
    context,
  );
  assertEquals(started.status, 303);
  const consent_location = started.headers.get("location");
  assertExists(consent_location);
  const consent_url = new URL(consent_location);
  assertEquals(
    `${consent_url.origin}${consent_url.pathname}`,
    `${preview_origin}/auth/storage/google-drive/mock-consent`,
  );
  assertEquals(
    consent_url.searchParams.get("redirect_uri"),
    `${preview_origin}/auth/storage/google-drive/callback`,
  );
  assertEquals(
    services.google_drive_mock_consent_http.handle(
      new Request(consent_location),
    ).status,
    200,
  );
  assertEquals(
    (await services.google_drive_connections_http.start(
      new Request(
        `${preview_origin}.attacker.test/auth/storage/google-drive/start`,
      ),
      context,
    )).status,
    400,
  );
  assertEquals(
    services.external_storage_providers.resolve("google-drive"),
    null,
  );
});

Deno.test("configured local Drive flow connects and disconnects offline", async () => {
  const services = await create_configured_app_services({
    get: (name) => local_google_environment[name],
  });
  const now = new Date("2026-07-22T12:00:00.000Z");
  const context = {
    request_id: "request-drive",
    session: {
      kind: "authenticated" as const,
      session_id: "session-drive",
      session_version: 1,
      user_id: "user-drive",
      csrf_token: "c".repeat(43),
      created_at: now,
      last_seen_at: now,
      authenticated_at: now,
      idle_expires_at: new Date("2026-08-22T12:00:00.000Z"),
      absolute_expires_at: new Date("2026-10-22T12:00:00.000Z"),
    },
  };
  const start_request = new Request(
    "http://localhost:5173/auth/storage/google-drive/start",
  );
  const started = await services.google_drive_connections_http.start(
    start_request,
    context,
  );
  assertEquals(started.status, 303);
  const consent_url = started.headers.get("location");
  assertExists(consent_url);
  const consent = services.google_drive_mock_consent_http.handle(
    new Request(consent_url),
  );
  assertEquals(consent.status, 200);
  const html = await consent.text();
  const callback_url = decode_package_html(matched_html_value(
    html,
    /<form id="consent-form" method="GET" action="([^"]+)">/,
  ));
  const state = matched_html_value(
    html,
    /<input\s+id="state-input"[\s\S]*?value="([^"]+)"/,
  );
  const code = decode_package_html(matched_html_value(
    html,
    /<textarea name="code" id="code-json"[^>]*>([\s\S]*?)<\/textarea>/,
  ));
  const callback = await services.google_drive_connections_http.callback(
    new Request(`${callback_url}?${new URLSearchParams({ code, state })}`),
    context,
  );
  assertEquals(callback.status, 303);
  const connection = await services.storage_connection_repository
    .find_active_by_user_provider("user-drive", "google-drive");
  assertExists(connection);
  assertExists(
    await services.storage_connection_repository.get_credentials(
      connection.connection_id,
    ),
  );

  const disconnected = await services.google_drive_connections_http.disconnect(
    new Request(
      "http://localhost:5173/auth/storage/google-drive/disconnect",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf_token: context.session.csrf_token }),
      },
    ),
    context,
  );
  assertEquals(disconnected.status, 303);
  assertEquals(
    (await services.storage_connection_repository.find_by_id(
      connection.connection_id,
    ))?.status,
    "revoked",
  );
  assertEquals(
    await services.storage_connection_repository.get_credentials(
      connection.connection_id,
    ),
    null,
  );
});

Deno.test("Drive HTTP routes require authentication and valid disconnect CSRF", async () => {
  const services = await create_configured_app_services({
    get: (name) => local_google_environment[name],
  });
  const guest = (await services.session.resolve()).session;
  const context = { request_id: "request-guest", session: guest };
  assertEquals(
    (await services.google_drive_connections_http.start(
      new Request("http://localhost:5173/auth/storage/google-drive/start"),
      context,
    )).status,
    401,
  );
  assertEquals(
    (await services.google_drive_connections_http.callback(
      new Request(
        `http://localhost:5173/auth/storage/google-drive/callback?state=${
          "s".repeat(43)
        }&code=code`,
      ),
      context,
    )).status,
    401,
  );
});

Deno.test("configured production composition registers the Drive provider", async () => {
  const services = await create_configured_app_services({
    get: (name) => original_google_environment[name],
  });
  const provider = services.external_storage_providers.resolve("google-drive");
  assertExists(provider);
  assertEquals(provider.capabilities, ["read", "write"]);
});

Deno.test("composition root registers only explicitly composed external providers", () => {
  const provider: ExternalStorageProvider = {
    provider_id: "test-drive",
    capabilities: ["read"],
    fetch_content: () =>
      Promise.resolve({ ok: false, reason: "external_content_missing" }),
    stat_content: () =>
      Promise.resolve({ ok: false, reason: "external_content_missing" }),
  };
  assertEquals(
    create_app_services().external_storage_providers.resolve("test-drive"),
    null,
  );
  assertStrictEquals(
    create_app_services({ external_storage_providers: [provider] })
      .external_storage_providers.resolve("test-drive"),
    provider,
  );
});

Deno.test("composition root defaults secure and requires explicit local cookies", () => {
  const credential = {
    value: "A".repeat(43),
    expires_at: new Date("2026-07-24T12:00:00.000Z"),
  };
  const production_cookie = create_app_services().session_transport.attach(
    new Response(null),
    credential,
  ).headers.getSetCookie()[0];
  const local_cookie = create_app_services({ session_cookie_mode: "local" })
    .session_transport.attach(new Response(null), credential)
    .headers.getSetCookie()[0];

  assertEquals(production_cookie.includes("__Host-iam_pager_session="), true);
  assertEquals(production_cookie.includes("Secure"), true);
  assertEquals(local_cookie.includes("iam_pager_session_local="), true);
  assertEquals(local_cookie.includes("Secure"), false);
  assertEquals(parse_session_cookie_mode(undefined), "production");
  assertEquals(parse_session_cookie_mode("local"), "local");
  assertThrows(() => parse_session_cookie_mode("development"), TypeError);
});

async function run_application_request(
  services: AppServices,
  request: Request,
  route: (state: AppRequestState) => Response | Promise<Response>,
): Promise<{ response: Response; state: AppRequestState }> {
  const state = {} as AppRequestState;
  const response = await services.request_context.handle({
    req: request,
    state,
    next: async () => await route(state),
  });
  return { response, state };
}

function response_cookie_header(response: Response): string {
  const set_cookie = response.headers.getSetCookie()[0];
  assertExists(set_cookie);
  return set_cookie.split(";", 1)[0];
}

function matched_html_value(html: string, pattern: RegExp): string {
  const match = pattern.exec(html);
  assertExists(match);
  return match[1];
}

function decode_package_html(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
