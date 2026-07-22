import { GAuth } from "@kindkitchen/gauth";
import { Effect, Layer } from "effect";
import { RequestHostMatcher } from "../auth/authentication-callback-url.ts";
import type {
  GAuthService,
  GoogleGAuthServiceResolver,
} from "../auth/google-gauth-strategy.ts";
import type { GoogleMockConsentScreen } from "../auth/google-gauth-composition.ts";
import {
  FetchGoogleDriveTokenRevoker,
  GoogleDriveGAuthClient,
  type GoogleDriveOAuthClient,
  LocalGoogleDriveTokenRevoker,
} from "./google-drive-oauth.ts";

export const GOOGLE_DRIVE_MODE_ENV = "IAM_PAGER_GOOGLE_DRIVE_MODE";
export const GOOGLE_DRIVE_REDIRECT_URI_ENV =
  "IAM_PAGER_GOOGLE_DRIVE_REDIRECT_URI";
export const GOOGLE_DRIVE_MOCK_CONSENT_URL_ENV =
  "IAM_PAGER_GOOGLE_DRIVE_MOCK_CONSENT_URL";
export const GOOGLE_DRIVE_CLIENT_ID_ENV = "IAM_PAGER_GOOGLE_DRIVE_CLIENT_ID";
export const GOOGLE_DRIVE_CLIENT_SECRET_ENV =
  "IAM_PAGER_GOOGLE_DRIVE_CLIENT_SECRET";
export const GOOGLE_DRIVE_REQUEST_HOST_PATTERN_ENV =
  "IAM_PAGER_GOOGLE_DRIVE_REQUEST_HOST_PATTERN";

const callback_path = "/auth/storage/google-drive/callback";
const consent_path = "/auth/storage/google-drive/mock-consent";
const max_request_host_pattern_length = 512;

export interface GoogleDriveEnvironmentSource {
  get(name: string): string | undefined;
}

export type GoogleDriveOAuthConfig =
  | {
    readonly mode: "local";
    readonly redirect_uri: string;
    readonly mocked_google_consent_screen_url: string;
    readonly request_host_pattern?: undefined;
  }
  | {
    readonly mode: "local";
    readonly redirect_uri?: undefined;
    readonly mocked_google_consent_screen_url?: undefined;
    readonly request_host_pattern: string;
  }
  | {
    readonly mode: "original";
    readonly redirect_uri: string;
    readonly client_id: string;
    readonly client_secret: string;
    readonly request_host_pattern?: string;
  };

export interface GoogleDriveOAuthComposition {
  readonly client: GoogleDriveOAuthClient;
  readonly mock_consent_screen: GoogleMockConsentScreen | null;
}

class GoogleDriveGAuthServiceResolver implements GoogleGAuthServiceResolver {
  readonly #config: GoogleDriveOAuthConfig;
  readonly #configured_service: GAuthService | null;
  readonly #host_matcher: RequestHostMatcher | null;

  constructor(config: GoogleDriveOAuthConfig, service: GAuthService | null) {
    this.#config = config;
    this.#configured_service = service;
    this.#host_matcher = config.request_host_pattern === undefined
      ? null
      : new RequestHostMatcher(config.request_host_pattern);
  }

  resolve(callback_url: string): Promise<GAuthService> {
    if (
      this.#configured_service !== null &&
      callback_url === this.#config.redirect_uri
    ) return Promise.resolve(this.#configured_service);
    if (
      this.#host_matcher === null ||
      !is_dynamic_callback_url(callback_url, this.#host_matcher)
    ) {
      return Promise.reject(
        new TypeError("untrusted Google Drive callback URL"),
      );
    }
    if (this.#config.mode === "local") {
      return compose_local_service(
        callback_url,
        new URL(consent_path, callback_url).href,
      );
    }
    return compose_original_service(this.#config, callback_url);
  }
}

class GoogleDriveMockConsentScreen implements GoogleMockConsentScreen {
  readonly callback_url: string;
  readonly #consent_url: string;
  readonly #host_matcher: RequestHostMatcher | null;
  readonly #render: (input: { state: string; redirect_uri: string }) => string;

  constructor(
    config: Extract<GoogleDriveOAuthConfig, { mode: "local" }>,
    render: (input: { state: string; redirect_uri: string }) => string,
  ) {
    this.callback_url = config.redirect_uri ?? "";
    this.#consent_url = config.mocked_google_consent_screen_url ?? "";
    this.#host_matcher = config.request_host_pattern === undefined
      ? null
      : new RequestHostMatcher(config.request_host_pattern);
    this.#render = render;
  }

  allows(request_url: URL, requested_callback_url: string): boolean {
    if (this.#host_matcher === null) {
      if (!this.callback_url || !this.#consent_url) return false;
      const consent_url = new URL(this.#consent_url);
      return request_url.origin === consent_url.origin &&
        request_url.pathname === consent_url.pathname &&
        requested_callback_url === this.callback_url;
    }
    try {
      const callback_url = new URL(requested_callback_url);
      return request_url.pathname === consent_path &&
        this.#host_matcher.matches(request_url) &&
        is_dynamic_callback_url(requested_callback_url, this.#host_matcher) &&
        callback_url.origin === request_url.origin;
    } catch {
      return false;
    }
  }

  render(state: string, requested_callback_url = this.callback_url): string {
    return this.#render({ state, redirect_uri: requested_callback_url });
  }
}

export function parse_google_drive_oauth_config(
  environment: GoogleDriveEnvironmentSource,
): GoogleDriveOAuthConfig {
  const mode = require_value(environment, GOOGLE_DRIVE_MODE_ENV);
  if (mode !== "local" && mode !== "original") {
    throw new TypeError(`${GOOGLE_DRIVE_MODE_ENV} must be local or original`);
  }
  const request_host_pattern = parse_host_pattern(environment);
  if (mode === "local") {
    if (request_host_pattern !== undefined) {
      return { mode, request_host_pattern };
    }
    const redirect_uri = require_value(
      environment,
      GOOGLE_DRIVE_REDIRECT_URI_ENV,
    );
    const mocked_google_consent_screen_url = require_value(
      environment,
      GOOGLE_DRIVE_MOCK_CONSENT_URL_ENV,
    );
    const redirect_url = parse_http_url(
      redirect_uri,
      GOOGLE_DRIVE_REDIRECT_URI_ENV,
      callback_path,
    );
    const consent_url = parse_http_url(
      mocked_google_consent_screen_url,
      GOOGLE_DRIVE_MOCK_CONSENT_URL_ENV,
      consent_path,
    );
    if (
      !is_loopback(redirect_url.hostname) ||
      redirect_url.origin !== consent_url.origin
    ) {
      throw new TypeError(
        "local Google Drive OAuth URLs must use the same loopback origin",
      );
    }
    return { mode, redirect_uri, mocked_google_consent_screen_url };
  }

  const redirect_uri = require_value(
    environment,
    GOOGLE_DRIVE_REDIRECT_URI_ENV,
  );
  const redirect_url = parse_http_url(
    redirect_uri,
    GOOGLE_DRIVE_REDIRECT_URI_ENV,
    callback_path,
  );
  if (
    redirect_url.protocol !== "https:" && !is_loopback(redirect_url.hostname)
  ) {
    throw new TypeError(
      `${GOOGLE_DRIVE_REDIRECT_URI_ENV} must use HTTPS outside loopback development`,
    );
  }
  return {
    mode,
    redirect_uri,
    client_id: require_value(environment, GOOGLE_DRIVE_CLIENT_ID_ENV),
    client_secret: require_value(environment, GOOGLE_DRIVE_CLIENT_SECRET_ENV),
    ...(request_host_pattern === undefined ? {} : { request_host_pattern }),
  };
}

export async function compose_google_drive_oauth(
  config: GoogleDriveOAuthConfig,
): Promise<GoogleDriveOAuthComposition> {
  if (config.mode === "local") {
    const dynamic = config.request_host_pattern !== undefined;
    const { Requirements } = await GAuth.load_preset.local();
    const service = dynamic ? null : await compose_local_service(
      config.redirect_uri!,
      config.mocked_google_consent_screen_url!,
    );
    const resolver = new GoogleDriveGAuthServiceResolver(config, service);
    return {
      client: new GoogleDriveGAuthClient({
        gauth: service,
        service_resolver: resolver,
        token_revoker: new LocalGoogleDriveTokenRevoker(),
      }),
      mock_consent_screen: new GoogleDriveMockConsentScreen(
        config,
        (input) => Requirements.render_consent_screen(input),
      ),
    };
  }
  const service = await compose_original_service(config, config.redirect_uri);
  const resolver = new GoogleDriveGAuthServiceResolver(config, service);
  return {
    client: new GoogleDriveGAuthClient({
      gauth: service,
      service_resolver: resolver,
      token_revoker: new FetchGoogleDriveTokenRevoker(),
    }),
    mock_consent_screen: null,
  };
}

function require_value(
  environment: GoogleDriveEnvironmentSource,
  name: string,
): string {
  const value = environment.get(name);
  if (
    value === undefined || value.length === 0 || value.length > 4096 ||
    value.trim() !== value
  ) throw new TypeError(`${name} must be a non-empty configured value`);
  return value;
}

function parse_host_pattern(
  environment: GoogleDriveEnvironmentSource,
): string | undefined {
  const value = environment.get(GOOGLE_DRIVE_REQUEST_HOST_PATTERN_ENV);
  if (value === undefined || value.length === 0) return undefined;
  if (
    value.length > max_request_host_pattern_length || value.trim() !== value
  ) throw new TypeError(`${GOOGLE_DRIVE_REQUEST_HOST_PATTERN_ENV} is invalid`);
  try {
    new RequestHostMatcher(value);
  } catch {
    throw new TypeError(`${GOOGLE_DRIVE_REQUEST_HOST_PATTERN_ENV} is invalid`);
  }
  return value;
}

function parse_http_url(value: string, name: string, path: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute HTTP(S) ${path} URL`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) || url.username ||
    url.password || url.search || url.hash || url.pathname !== path
  ) throw new TypeError(`${name} must be an absolute HTTP(S) ${path} URL`);
  return url;
}

function is_loopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "[::1]";
}

function is_dynamic_callback_url(
  value: string,
  matcher: RequestHostMatcher,
): boolean {
  try {
    const url = new URL(value);
    return url.pathname === callback_path && !url.search && !url.hash &&
      matcher.matches(url);
  } catch {
    return false;
  }
}

async function compose_local_service(
  redirect_uri: string,
  consent_url: string,
): Promise<GAuthService> {
  const { Preset, Requirements } = await GAuth.load_preset.local();
  const layer = Preset.pipe(Layer.provide(Layer.succeed(Requirements, {
    REDIRECT_URI: redirect_uri,
    MOCKED_GOOGLE_CONSENT_SCREEN_URL: consent_url,
  })));
  return await Effect.runPromise(
    Effect.gen(function* () {
      return yield* GAuth.Interface;
    }).pipe(Effect.provide(layer)),
  );
}

async function compose_original_service(
  config: Extract<GoogleDriveOAuthConfig, { mode: "original" }>,
  redirect_uri: string,
): Promise<GAuthService> {
  const { Preset, Requirements } = await GAuth.load_preset.original();
  const layer = Preset.pipe(Layer.provide(Layer.succeed(Requirements, {
    GOOGLE_CLIENT_ID: config.client_id,
    GOOGLE_CLIENT_SECRET: config.client_secret,
    REDIRECT_URIS: [redirect_uri],
  })));
  return await Effect.runPromise(
    Effect.gen(function* () {
      return yield* GAuth.Interface;
    }).pipe(Effect.provide(layer)),
  );
}
