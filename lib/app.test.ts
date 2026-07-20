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
  type AppServices,
  create_app_services,
  create_configured_app_services,
  parse_session_cookie_mode,
  SESSION_COOKIE_MODE_ENV,
} from "./app.ts";
import { pdf_media_type } from "./content/mod.ts";
import { MemoryNamespaceRepository } from "./namespace/mod.ts";
import { deliver_page_locator_path, MemoryPageRepository } from "./page/mod.ts";
import type { AppRequestState } from "./request-context.ts";
import {
  hash_session_credential,
  MemorySessionRepository,
} from "./session/mod.ts";
import {
  OWNERSHIP_DENO_KV_PATH_ENV,
  OWNERSHIP_STORAGE_BACKEND_ENV,
  type OwnershipRepositoryFactory,
  type OwnershipStorageConfig,
  PAGE_STORAGE_BACKEND_ENV,
  type PageRepositoryFactory,
  type PageStorageConfig,
  SESSION_STORAGE_BACKEND_ENV,
  type SessionRepositoryFactory,
  type SessionStorageConfig,
} from "./storage/mod.ts";

const text_encoder = new TextEncoder();

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

Deno.test("composition root exposes page HTTP creation and direct delivery over one service", async () => {
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
});

Deno.test("composition root registers the transport-independent PDF core", async () => {
  const services = create_app_services();
  const bytes = pdf_bytes();
  const created = await services.pages.publish_trial({
    actor: { kind: "guest" },
    locator: { namespace: "Guest", page_name: "report" },
    access: "public",
    content: {
      content_type: "pdf",
      input: { bytes, filename: "report.data" },
    },
  });
  assertEquals(created.ok, true);

  const delivered = await services.pages.deliver(
    { namespace: "Guest", page_name: "report" },
    { kind: "guest" },
  );
  assertEquals(delivered.ok, true);
  if (!delivered.ok) return;
  assertEquals(delivered.payload.media_type, pdf_media_type);
  assertEquals(delivered.payload.download_filename, "report.data");
  assertEquals(delivered.payload.body, bytes);
});

Deno.test("composition root exposes public exploration over the shared page service", async () => {
  const services = create_app_services();
  await services.namespaces.reserve({
    namespace: "Alice",
    owner_user_id: "owner-1",
  });
  const public_page = await services.pages.create_managed({
    actor: { kind: "user", user_id: "owner-1" },
    locator: { namespace: "Alice", page_name: "Notes" },
    access: "public",
    tags: ["News"],
    content: { content_type: "md-page", input: { md: "# Public" } },
  });
  const private_page = await services.pages.create_managed({
    actor: { kind: "user", user_id: "owner-1" },
    locator: { namespace: "Alice", page_name: "Secret" },
    access: "private",
    content: { content_type: "md-page", input: { md: "# Private" } },
  });
  const trial_page = await services.pages.publish_trial({
    actor: { kind: "guest" },
    locator: { namespace: "Free", page_name: "Notes" },
    access: "public",
    content: { content_type: "md-page", input: { md: "# Trial" } },
  });
  assertEquals(public_page.ok, true);
  assertEquals(private_page.ok, true);
  assertEquals(trial_page.ok, true);

  const exploration = await services.public_exploration.present({
    page_name_query: "notes",
    tag: "news",
  });
  assertEquals(
    exploration.pages.map((page) => page.site_path),
    ["/site/Alice/Notes"],
  );
});

Deno.test("composition root forbids platform route namespaces", async () => {
  const { pages } = create_app_services();
  for (const namespace of ["site", "API", "Auth"]) {
    const result = await pages.publish_trial({
      actor: { kind: "guest" },
      locator: { namespace },
      access: "public",
      content: { content_type: "md-page", input: { md: "x" } },
    });
    assertEquals(result, { ok: false, reason: "forbidden_namespace" });
  }
});

Deno.test("composition root shares namespace authority across management", async () => {
  const { pages, namespaces } = create_app_services();
  const reserved = await namespaces.reserve({
    namespace: "Claimed",
    owner_user_id: "owner-1",
  });
  assertEquals(reserved.ok, true);

  const guest_write = await pages.publish_trial({
    actor: { kind: "guest" },
    locator: { namespace: "claimed" },
    access: "public",
    content: { content_type: "md-page", input: { md: "# Takeover" } },
  });
  assertEquals(guest_write, { ok: false, reason: "namespace_reserved" });

  const owner_write = await pages.create_managed({
    actor: { kind: "user", user_id: "owner-1" },
    locator: { namespace: "Claimed" },
    access: "private",
    content: { content_type: "md-page", input: { md: "# Mine" } },
  });
  assertEquals(owner_write.ok, true);

  assertEquals(
    await namespaces.reserve({ namespace: "api", owner_user_id: "owner-1" }),
    { ok: false, reason: "forbidden_namespace" },
  );
  assertEquals(
    (await namespaces.list_owned("owner-1")).map((reservation) =>
      reservation.namespace
    ),
    ["Claimed"],
  );
});

Deno.test("composed direct delivery hides private pages from non-owners", async () => {
  const services = create_app_services();
  await services.namespaces.reserve({
    namespace: "Private",
    owner_user_id: "owner-1",
  });
  const created = await services.pages.create_managed({
    actor: { kind: "user", user_id: "owner-1" },
    locator: { namespace: "Private" },
    access: "private",
    content: { content_type: "md-page", input: { md: "# Secret" } },
  });
  assertEquals(created.ok, true);

  const guest = await deliver_page_locator_path(
    services.engine,
    services.pages,
    "/Private",
    { kind: "guest" },
  );
  const other_user = await deliver_page_locator_path(
    services.engine,
    services.pages,
    "/Private",
    { kind: "user", user_id: "owner-2" },
  );
  const owner = await deliver_page_locator_path(
    services.engine,
    services.pages,
    "/Private",
    { kind: "user", user_id: "owner-1" },
  );

  assertEquals(guest.status, 404);
  assertEquals(await guest.text(), "page not found\n");
  assertEquals(other_user.status, 404);
  assertEquals(await other_user.text(), "page not found\n");
  assertEquals(owner.status, 200);
  assertStringIncludes(await owner.text(), "Secret");
});

Deno.test("composition root wires interface-backed identity services", async () => {
  const services = create_app_services();
  assertEquals(services.authentication_strategies.resolve("google"), null);

  const identity = await services.identity_repository.find_or_create({
    strategy_id: "fake",
    provider_subject: "subject-1",
    email: "person@example.com",
    observed_at: new Date("2026-07-18T12:00:00.000Z"),
  });
  assertEquals(identity.created, true);
  assertEquals(identity.identity.user_id, identity.user.user_id);
});

Deno.test("configured composition registers the selected Google strategy", async () => {
  const values: Readonly<Record<string, string>> = {
    [SESSION_COOKIE_MODE_ENV]: "local",
    [GOOGLE_AUTH_MODE_ENV]: "local",
    [GOOGLE_AUTH_REDIRECT_URI_ENV]:
      "http://localhost:5173/auth/google/callback",
    [GOOGLE_AUTH_MOCK_CONSENT_URL_ENV]:
      "http://localhost:5173/auth/google/mock-consent",
  };
  const services = await create_configured_app_services({
    get: (name) => values[name],
  });

  assertEquals(
    services.authentication_strategies.resolve("google")?.strategy_id,
    "google",
  );
  assertEquals(services.authentication_strategies.resolve("unknown"), null);
});

Deno.test("configured composition selects linked ownership storage at its factory boundary", async () => {
  const selected_identity_repository = new MemoryIdentityRepository({
    generate: () => "user-a",
  });
  const selected_namespace_repository = new MemoryNamespaceRepository();
  let selected_config: OwnershipStorageConfig | undefined;
  const ownership_repository_factory: OwnershipRepositoryFactory = {
    create: (config) => {
      selected_config = config;
      return Promise.resolve({
        identity_repository: selected_identity_repository,
        namespace_repository: selected_namespace_repository,
      });
    },
  };
  const values: Readonly<Record<string, string>> = {
    [GOOGLE_AUTH_MODE_ENV]: "local",
    [GOOGLE_AUTH_REDIRECT_URI_ENV]:
      "http://localhost:5173/auth/google/callback",
    [GOOGLE_AUTH_MOCK_CONSENT_URL_ENV]:
      "http://localhost:5173/auth/google/mock-consent",
    [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
    [OWNERSHIP_DENO_KV_PATH_ENV]: "/data/iam-pager.kv",
  };

  const services = await create_configured_app_services(
    { get: (name) => values[name] },
    { ownership_repository_factory },
  );

  assertEquals(selected_config, {
    backend: "deno-kv",
    path: "/data/iam-pager.kv",
  });
  assertStrictEquals(
    services.identity_repository,
    selected_identity_repository,
  );
  assertStrictEquals(
    services.namespace_repository,
    selected_namespace_repository,
  );
  const identity = await services.identity_repository.find_or_create({
    strategy_id: "google",
    provider_subject: "provider-user",
    email: "person@example.com",
    observed_at: new Date("2026-07-18T00:00:00.000Z"),
  });
  const reserved = await services.namespaces.reserve({
    namespace: "Selected",
    owner_user_id: identity.user.user_id,
  });
  assertEquals(reserved.ok, true);
  assertEquals(
    (await selected_namespace_repository.find("selected"))?.owner_user_id,
    identity.user.user_id,
  );
});

Deno.test("configured composition selects referentially safe session storage", async () => {
  const selected_session_repository = new MemorySessionRepository();
  let selected_config: SessionStorageConfig | undefined;
  const session_repository_factory: SessionRepositoryFactory = {
    create: (config) => {
      selected_config = config;
      return Promise.resolve(selected_session_repository);
    },
  };
  const values: Readonly<Record<string, string>> = {
    [GOOGLE_AUTH_MODE_ENV]: "local",
    [GOOGLE_AUTH_REDIRECT_URI_ENV]:
      "http://localhost:5173/auth/google/callback",
    [GOOGLE_AUTH_MOCK_CONSENT_URL_ENV]:
      "http://localhost:5173/auth/google/mock-consent",
    [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
    [OWNERSHIP_DENO_KV_PATH_ENV]: "/data/iam-pager.kv",
    [SESSION_STORAGE_BACKEND_ENV]: "deno-kv",
  };

  const services = await create_configured_app_services(
    { get: (name) => values[name] },
    {
      ownership_repository_factory: {
        create: () =>
          Promise.resolve({
            identity_repository: new MemoryIdentityRepository({
              generate: () => "user-a",
            }),
            namespace_repository: new MemoryNamespaceRepository(),
          }),
      },
      session_repository_factory,
    },
  );

  assertEquals(selected_config, {
    backend: "deno-kv",
    path: "/data/iam-pager.kv",
  });
  const resolution = await services.session.resolve();
  assertExists(resolution.credential_to_set);
  assertEquals(
    (
      await selected_session_repository.find_by_credential_hash(
        await hash_session_credential(resolution.credential_to_set.value),
      )
    )?.session_id,
    resolution.session.session_id,
  );
});

Deno.test("configured composition selects referentially safe page storage", async () => {
  const selected_page_repository = new MemoryPageRepository();
  let selected_config: PageStorageConfig | undefined;
  const page_repository_factory: PageRepositoryFactory = {
    create: (config) => {
      selected_config = config;
      return Promise.resolve(selected_page_repository);
    },
  };
  const values: Readonly<Record<string, string>> = {
    [GOOGLE_AUTH_MODE_ENV]: "local",
    [GOOGLE_AUTH_REDIRECT_URI_ENV]:
      "http://localhost:5173/auth/google/callback",
    [GOOGLE_AUTH_MOCK_CONSENT_URL_ENV]:
      "http://localhost:5173/auth/google/mock-consent",
    [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
    [OWNERSHIP_DENO_KV_PATH_ENV]: "/data/iam-pager.kv",
    [PAGE_STORAGE_BACKEND_ENV]: "deno-kv",
  };

  const services = await create_configured_app_services(
    { get: (name) => values[name] },
    {
      ownership_repository_factory: {
        create: () =>
          Promise.resolve({
            identity_repository: new MemoryIdentityRepository({
              generate: () => "user-a",
            }),
            namespace_repository: new MemoryNamespaceRepository(),
          }),
      },
      page_repository_factory,
    },
  );

  assertEquals(selected_config, {
    backend: "deno-kv",
    path: "/data/iam-pager.kv",
  });
  assertStrictEquals(services.page_repository, selected_page_repository);
  const published = await services.pages.publish_trial({
    actor: { kind: "guest" },
    locator: { namespace: "Durable", page_name: "hello" },
    access: "public",
    content: { content_type: "md-page", input: { md: "# Durable" } },
  });
  assertEquals(published.ok, true);
  assertEquals(
    (await selected_page_repository.find_by_locator({
      namespace: "durable",
      page_name: "hello",
    }))?.content.content_type,
    "md-page",
  );
});

Deno.test("configured original Google flow prefers an allowlisted request host", async () => {
  const values: Readonly<Record<string, string>> = {
    [GOOGLE_AUTH_MODE_ENV]: "original",
    [GOOGLE_AUTH_REDIRECT_URI_ENV]:
      "https://pager.example/auth/google/callback",
    [GOOGLE_AUTH_CLIENT_ID_ENV]: "test-client-id",
    [GOOGLE_AUTH_CLIENT_SECRET_ENV]: "not-a-real-secret",
    [GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV]:
      "pager-pr-[a-z0-9-]+\\.example\\.com",
  };
  const services = await create_configured_app_services({
    get: (name) => values[name],
  });
  const start_request = new Request(
    "https://pager-pr-change-42.example.com/auth/google/start",
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
  const authorization_location = started.response.headers.get("location");
  assertExists(authorization_location);
  assertEquals(
    new URL(authorization_location).searchParams.get("redirect_uri"),
    "https://pager-pr-change-42.example.com/auth/google/callback",
  );
});

Deno.test("configured local Google flow prefers an allowlisted preview origin over partial static URLs", async () => {
  const values: Readonly<Record<string, string>> = {
    [GOOGLE_AUTH_MODE_ENV]: "local",
    [GOOGLE_AUTH_REDIRECT_URI_ENV]:
      "http://localhost:5173/auth/google/callback",
    [GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV]:
      "pager-pr-[a-z0-9-]+\\.example\\.com",
  };
  const services = await create_configured_app_services({
    get: (name) => values[name],
  });
  const start_request = new Request(
    "https://pager-pr-change-42.example.com/auth/google/start",
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
  const guest_cookie = response_cookie_header(started.response);
  const consent_location = started.response.headers.get("location");
  assertExists(consent_location);
  const consent_url = new URL(consent_location);

  assertEquals(
    `${consent_url.origin}${consent_url.pathname}`,
    "https://pager-pr-change-42.example.com/auth/google/mock-consent",
  );
  assertEquals(
    consent_url.searchParams.get("redirect_uri"),
    "https://pager-pr-change-42.example.com/auth/google/callback",
  );
  const consent_response = services.google_mock_consent_http.handle(
    new Request(consent_url),
  );
  assertEquals(consent_response.status, 200);
  const consent_html = await consent_response.text();
  assertStringIncludes(
    consent_html,
    'action="https://pager-pr-change-42.example.com/auth/google/callback"',
  );
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
  assertEquals(callback.state.request_context.session.kind, "authenticated");
});

Deno.test("configured local Google browser flow renders consent and upgrades the session", async () => {
  const values: Readonly<Record<string, string>> = {
    [SESSION_COOKIE_MODE_ENV]: "local",
    [GOOGLE_AUTH_MODE_ENV]: "local",
    [GOOGLE_AUTH_REDIRECT_URI_ENV]:
      "http://localhost:5173/auth/google/callback",
    [GOOGLE_AUTH_MOCK_CONSENT_URL_ENV]:
      "http://localhost:5173/auth/google/mock-consent",
  };
  const services = await create_configured_app_services({
    get: (name) => values[name],
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
  assertEquals(started.state.request_context.session.kind, "guest");
  const original_session_id = started.state.request_context.session.session_id;
  const guest_cookie = response_cookie_header(started.response);
  const consent_location = started.response.headers.get("location");
  assertExists(consent_location);

  const consent_request = new Request(consent_location, {
    headers: { cookie: guest_cookie },
  });
  const consent = await run_application_request(
    services,
    consent_request,
    () => services.google_mock_consent_http.handle(consent_request),
  );
  assertEquals(consent.response.status, 200);
  assertEquals(
    consent.state.request_context.session.session_id,
    original_session_id,
  );
  const consent_html = await consent.response.text();
  assertStringIncludes(consent_html, "Mocked Google Consent Screen");
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
  assertEquals(state, new URL(consent_location).searchParams.get("state"));

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
    original_session_id,
  );
  const authenticated_cookie = response_cookie_header(callback.response);
  assertEquals(authenticated_cookie === guest_cookie, false);

  const authenticated_request = new Request("http://localhost:5173/", {
    headers: { cookie: authenticated_cookie },
  });
  const authenticated = await run_application_request(
    services,
    authenticated_request,
    () => new Response(null, { status: 204 }),
  );
  assertEquals(
    authenticated.state.request_context.session.kind,
    "authenticated",
  );
  assertEquals(
    authenticated.state.request_context.session.session_id,
    original_session_id,
  );

  const stale_request = new Request("http://localhost:5173/", {
    headers: { cookie: guest_cookie },
  });
  const stale = await run_application_request(
    services,
    stale_request,
    () => new Response(null, { status: 204 }),
  );
  assertEquals(stale.state.request_context.session.kind, "guest");
  assertEquals(
    stale.state.request_context.session.session_id === original_session_id,
    false,
  );

  const authenticated_session = callback.state.request_context.session;
  if (authenticated_session.kind !== "authenticated") return;
  const logout_request = new Request(
    "http://localhost:5173/auth/logout",
    {
      method: "POST",
      headers: {
        cookie: authenticated_cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf_token: authenticated_session.csrf_token,
      }),
    },
  );
  const logged_out = await run_application_request(
    services,
    logout_request,
    async (request_state) => {
      const result = await services.authentication_http.logout(
        logout_request,
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
  assertEquals(logged_out.response.status, 303);
  assertEquals(logged_out.response.headers.get("location"), "/");
  assertEquals(logged_out.state.request_context.session.kind, "guest");
  assertEquals(
    logged_out.state.request_context.session.session_id === original_session_id,
    false,
  );
  const fresh_guest_session_id =
    logged_out.state.request_context.session.session_id;
  const fresh_guest_cookie = response_cookie_header(logged_out.response);
  assertEquals(fresh_guest_cookie === authenticated_cookie, false);

  const fresh_guest_request = new Request("http://localhost:5173/", {
    headers: { cookie: fresh_guest_cookie },
  });
  const fresh_guest = await run_application_request(
    services,
    fresh_guest_request,
    () => new Response(null, { status: 204 }),
  );
  assertEquals(fresh_guest.state.request_context.session.kind, "guest");
  assertEquals(
    fresh_guest.state.request_context.session.session_id,
    fresh_guest_session_id,
  );

  const stale_authenticated_request = new Request("http://localhost:5173/", {
    headers: { cookie: authenticated_cookie },
  });
  const stale_authenticated = await run_application_request(
    services,
    stale_authenticated_request,
    () => new Response(null, { status: 204 }),
  );
  assertEquals(
    stale_authenticated.state.request_context.session.kind,
    "guest",
  );
  assertEquals(
    stale_authenticated.state.request_context.session.session_id ===
      original_session_id,
    false,
  );
  assertEquals(
    stale_authenticated.state.request_context.session.session_id ===
      fresh_guest_session_id,
    false,
  );
});

Deno.test("configured local callback failure is recoverable and preserves its guest", async () => {
  const values: Readonly<Record<string, string>> = {
    [SESSION_COOKIE_MODE_ENV]: "local",
    [GOOGLE_AUTH_MODE_ENV]: "local",
    [GOOGLE_AUTH_REDIRECT_URI_ENV]:
      "http://localhost:5173/auth/google/callback",
    [GOOGLE_AUTH_MOCK_CONSENT_URL_ENV]:
      "http://localhost:5173/auth/google/mock-consent",
  };
  const services = await create_configured_app_services({
    get: (name) => values[name],
  });
  const start_request = new Request(
    "http://localhost:5173/auth/google/start?return_to=%2Fsite%2Fdraft",
  );
  const started = await run_application_request(
    services,
    start_request,
    async (request_state) =>
      (await services.authentication_http.start(
        start_request,
        "google",
        request_state.request_context,
      )).response,
  );
  const guest_cookie = response_cookie_header(started.response);
  const original_session_id = started.state.request_context.session.session_id;
  const consent_location = started.response.headers.get("location");
  assertExists(consent_location);
  const callback_state = new URL(consent_location).searchParams.get("state");
  assertExists(callback_state);
  const callback_url =
    `http://localhost:5173/auth/google/callback?${new URLSearchParams({
      code: "invalid-local-provider-code",
      state: callback_state,
    })}`;

  const fail_callback = async () => {
    const callback_request = new Request(callback_url, {
      headers: { cookie: guest_cookie },
    });
    return await run_application_request(
      services,
      callback_request,
      async (request_state) => {
        const result = await services.authentication_http.callback(
          callback_request,
          "google",
          request_state.request_context,
        );
        return result.response;
      },
    );
  };

  const failed = await fail_callback();
  assertEquals(failed.response.status, 502);
  assertEquals(
    failed.state.request_context.session.session_id,
    original_session_id,
  );
  const failure_html = await failed.response.text();
  assertStringIncludes(failure_html, 'href="/auth/google/start"');
  assertEquals(failure_html.includes("invalid-local-provider-code"), false);
  assertEquals(failure_html.includes(callback_state), false);

  const replayed = await fail_callback();
  assertEquals(replayed.response.status, 400);
  assertStringIncludes(
    await replayed.response.text(),
    'href="/auth/google/start"',
  );

  const surviving_request = new Request("http://localhost:5173/site/draft", {
    headers: { cookie: guest_cookie },
  });
  const surviving = await run_application_request(
    services,
    surviving_request,
    () => new Response(null, { status: 204 }),
  );
  assertEquals(surviving.state.request_context.session.kind, "guest");
  assertEquals(
    surviving.state.request_context.session.session_id,
    original_session_id,
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
