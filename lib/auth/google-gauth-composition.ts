import { GAuth } from "@kindkitchen/gauth";
import { Effect, Layer } from "effect";
import { RequestHostMatcher } from "./authentication-callback-url.ts";
import type {
  GAuthService,
  GoogleGAuthServiceResolver,
} from "./google-gauth-strategy.ts";

export const GOOGLE_AUTH_MODE_ENV = "IAM_PAGER_GOOGLE_AUTH_MODE";
export const GOOGLE_AUTH_REDIRECT_URI_ENV =
  "IAM_PAGER_GOOGLE_AUTH_REDIRECT_URI";
export const GOOGLE_AUTH_MOCK_CONSENT_URL_ENV =
  "IAM_PAGER_GOOGLE_AUTH_MOCK_CONSENT_URL";
export const GOOGLE_AUTH_CLIENT_ID_ENV = "IAM_PAGER_GOOGLE_AUTH_CLIENT_ID";
export const GOOGLE_AUTH_CLIENT_SECRET_ENV =
  "IAM_PAGER_GOOGLE_AUTH_CLIENT_SECRET";
export const GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV =
  "IAM_PAGER_GOOGLE_AUTH_REQUEST_HOST_PATTERN";

const MAX_REQUEST_HOST_PATTERN_LENGTH = 512;

export interface EnvironmentSource {
  get(name: string): string | undefined;
}

export interface StaticLocalGoogleAuthConfig {
  readonly mode: "local";
  readonly redirect_uri: string;
  readonly mocked_google_consent_screen_url: string;
  readonly request_host_pattern?: undefined;
}

export interface DynamicLocalGoogleAuthConfig {
  readonly mode: "local";
  readonly redirect_uri?: undefined;
  readonly mocked_google_consent_screen_url?: undefined;
  readonly request_host_pattern: string;
}

export type LocalGoogleAuthConfig =
  | StaticLocalGoogleAuthConfig
  | DynamicLocalGoogleAuthConfig;

export interface OriginalGoogleAuthConfig {
  readonly mode: "original";
  readonly redirect_uri: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly request_host_pattern?: string;
}

export type GoogleAuthConfig =
  | LocalGoogleAuthConfig
  | OriginalGoogleAuthConfig;

/** Package-owned local consent rendering kept behind an application interface. */
export interface GoogleMockConsentScreen {
  readonly callback_url: string;
  allows(request_url: URL, callback_url: string): boolean;
  render(state: string, callback_url?: string): string;
}

export interface GoogleGAuthComposition {
  readonly service: GAuthService | null;
  readonly service_resolver: GoogleGAuthServiceResolver;
  readonly mock_consent_screen: GoogleMockConsentScreen | null;
}

class PackageGoogleGAuthServiceResolver implements GoogleGAuthServiceResolver {
  readonly #config: GoogleAuthConfig;
  readonly #configured_service: GAuthService | null;
  readonly #request_host_matcher: RequestHostMatcher | null;

  constructor(
    config: GoogleAuthConfig,
    configured_service: GAuthService | null,
  ) {
    this.#config = config;
    this.#configured_service = configured_service;
    this.#request_host_matcher = config.request_host_pattern === undefined
      ? null
      : new RequestHostMatcher(config.request_host_pattern);
  }

  resolve(callback_url: string): Promise<GAuthService> {
    if (
      this.#configured_service !== null &&
      callback_url === this.#config.redirect_uri
    ) {
      return Promise.resolve(this.#configured_service);
    }
    if (
      this.#request_host_matcher === null ||
      !is_dynamic_google_callback_url(
        callback_url,
        this.#request_host_matcher,
      )
    ) {
      return Promise.reject(new TypeError("untrusted Google callback URL"));
    }
    if (this.#config.mode === "local") {
      return compose_local_google_gauth_service(
        callback_url,
        new URL("/auth/google/mock-consent", callback_url).href,
      );
    }
    return compose_original_google_gauth_service(this.#config, callback_url);
  }
}

class PackageGoogleMockConsentScreen implements GoogleMockConsentScreen {
  readonly callback_url: string;
  readonly #consent_url: string;
  readonly #request_host_matcher: RequestHostMatcher | null;
  readonly #render_consent_screen: (
    input: { state: string; redirect_uri: string },
  ) => string;

  constructor(
    config: LocalGoogleAuthConfig,
    render_consent_screen: (
      input: { state: string; redirect_uri: string },
    ) => string,
  ) {
    this.callback_url = config.redirect_uri ?? "";
    this.#consent_url = config.mocked_google_consent_screen_url ?? "";
    this.#request_host_matcher = config.request_host_pattern === undefined
      ? null
      : new RequestHostMatcher(config.request_host_pattern);
    this.#render_consent_screen = render_consent_screen;
  }

  allows(request_url: URL, callback_url: string): boolean {
    if (this.#request_host_matcher === null) {
      if (this.callback_url === "" || this.#consent_url === "") return false;
      const consent_url = new URL(this.#consent_url);
      return request_url.origin === consent_url.origin &&
        request_url.pathname === consent_url.pathname &&
        callback_url === this.callback_url;
    }
    try {
      const parsed_callback_url = new URL(callback_url);
      return request_url.pathname === "/auth/google/mock-consent" &&
        this.#request_host_matcher.matches(request_url) &&
        is_dynamic_google_callback_url(
          callback_url,
          this.#request_host_matcher,
        ) && parsed_callback_url.origin === request_url.origin;
    } catch {
      return false;
    }
  }

  render(state: string, callback_url = this.callback_url): string {
    return this.#render_consent_screen({ state, redirect_uri: callback_url });
  }
}

function require_environment_value(
  environment: EnvironmentSource,
  name: string,
): string {
  const value = environment.get(name);
  if (
    value === undefined || value.length === 0 || value.length > 4096 ||
    value.trim() !== value
  ) {
    throw new TypeError(`${name} must be a non-empty configured value`);
  }
  return value;
}

function parse_request_host_pattern(
  environment: EnvironmentSource,
): string | undefined {
  const value = environment.get(GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV);
  if (value === undefined || value.length === 0) return undefined;
  if (
    value.length > MAX_REQUEST_HOST_PATTERN_LENGTH || value.trim() !== value
  ) {
    throw new TypeError(
      `${GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV} must be an unpadded regular expression of at most ${MAX_REQUEST_HOST_PATTERN_LENGTH} characters`,
    );
  }
  try {
    new RequestHostMatcher(value);
  } catch {
    throw new TypeError(
      `${GOOGLE_AUTH_REQUEST_HOST_PATTERN_ENV} must be a valid regular expression`,
    );
  }
  return value;
}

function parse_callback_url(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(
      `${GOOGLE_AUTH_REDIRECT_URI_ENV} must be an absolute HTTP(S) URL`,
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" || url.password !== "" || url.search !== "" ||
    url.hash !== "" || url.pathname !== "/auth/google/callback"
  ) {
    throw new TypeError(
      `${GOOGLE_AUTH_REDIRECT_URI_ENV} must be an absolute HTTP(S) /auth/google/callback URL without credentials, query, or fragment`,
    );
  }
  return url;
}

function parse_mock_consent_url(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(
      `${GOOGLE_AUTH_MOCK_CONSENT_URL_ENV} must be an absolute HTTP(S) URL`,
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" || url.password !== "" || url.search !== "" ||
    url.hash !== "" || url.pathname !== "/auth/google/mock-consent"
  ) {
    throw new TypeError(
      `${GOOGLE_AUTH_MOCK_CONSENT_URL_ENV} must be an absolute HTTP(S) /auth/google/mock-consent URL without credentials, query, or fragment`,
    );
  }
  return url;
}

function is_loopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "[::1]";
}

function is_dynamic_google_callback_url(
  value: string,
  request_host_matcher: RequestHostMatcher,
): boolean {
  try {
    const url = new URL(value);
    return url.pathname === "/auth/google/callback" && url.search === "" &&
      url.hash === "" && request_host_matcher.matches(url);
  } catch {
    return false;
  }
}

/** Reads and validates one explicit gauth preset configuration. */
export function parse_google_auth_config(
  environment: EnvironmentSource,
): GoogleAuthConfig {
  const mode = require_environment_value(environment, GOOGLE_AUTH_MODE_ENV);
  if (mode !== "local" && mode !== "original") {
    throw new TypeError(`${GOOGLE_AUTH_MODE_ENV} must be local or original`);
  }

  const request_host_pattern = parse_request_host_pattern(environment);

  if (mode === "local") {
    if (request_host_pattern !== undefined) {
      return { mode, request_host_pattern };
    }

    const redirect_uri = require_environment_value(
      environment,
      GOOGLE_AUTH_REDIRECT_URI_ENV,
    );
    const mocked_google_consent_screen_url = require_environment_value(
      environment,
      GOOGLE_AUTH_MOCK_CONSENT_URL_ENV,
    );
    const redirect_url = parse_callback_url(redirect_uri);
    const consent_url = parse_mock_consent_url(
      mocked_google_consent_screen_url,
    );
    if (
      !is_loopback(redirect_url.hostname) ||
      consent_url.origin !== redirect_url.origin
    ) {
      throw new TypeError(
        "local Google authentication URLs must use the same loopback origin",
      );
    }
    return { mode, redirect_uri, mocked_google_consent_screen_url };
  }

  const redirect_uri = require_environment_value(
    environment,
    GOOGLE_AUTH_REDIRECT_URI_ENV,
  );
  const redirect_url = parse_callback_url(redirect_uri);
  if (
    redirect_url.protocol !== "https:" && !is_loopback(redirect_url.hostname)
  ) {
    throw new TypeError(
      `${GOOGLE_AUTH_REDIRECT_URI_ENV} must use HTTPS outside loopback development`,
    );
  }
  return {
    mode,
    redirect_uri,
    client_id: require_environment_value(
      environment,
      GOOGLE_AUTH_CLIENT_ID_ENV,
    ),
    client_secret: require_environment_value(
      environment,
      GOOGLE_AUTH_CLIENT_SECRET_ENV,
    ),
    ...(request_host_pattern === undefined ? {} : { request_host_pattern }),
  };
}

/** Loads only the selected preset and returns its application adapters. */
export async function compose_google_gauth(
  config: GoogleAuthConfig,
): Promise<GoogleGAuthComposition> {
  if (config.mode === "local") {
    const uses_dynamic_urls = config.request_host_pattern !== undefined;
    if (
      !uses_dynamic_urls &&
      (config.redirect_uri === undefined ||
        config.mocked_google_consent_screen_url === undefined)
    ) {
      throw new TypeError(
        "local Google authentication requires static URLs or a request host pattern",
      );
    }
    const { Requirements } = await GAuth.load_preset.local();
    const service = uses_dynamic_urls
      ? null
      : await compose_local_google_gauth_service(
        config.redirect_uri,
        config.mocked_google_consent_screen_url,
      );
    return {
      service,
      service_resolver: new PackageGoogleGAuthServiceResolver(config, service),
      mock_consent_screen: new PackageGoogleMockConsentScreen(
        config,
        (input) => Requirements.render_consent_screen(input),
      ),
    };
  }

  const service = await compose_original_google_gauth_service(
    config,
    config.redirect_uri,
  );
  return {
    service,
    service_resolver: new PackageGoogleGAuthServiceResolver(config, service),
    mock_consent_screen: null,
  };
}

async function compose_local_google_gauth_service(
  redirect_uri: string,
  mocked_google_consent_screen_url: string,
): Promise<GAuthService> {
  const { Preset, Requirements } = await GAuth.load_preset.local();
  const layer = Preset.pipe(
    Layer.provide(
      Layer.succeed(Requirements, {
        REDIRECT_URI: redirect_uri,
        MOCKED_GOOGLE_CONSENT_SCREEN_URL: mocked_google_consent_screen_url,
      }),
    ),
  );
  return await Effect.runPromise(
    Effect.gen(function* () {
      return yield* GAuth.Interface;
    }).pipe(Effect.provide(layer)),
  );
}

async function compose_original_google_gauth_service(
  config: OriginalGoogleAuthConfig,
  redirect_uri: string,
): Promise<GAuthService> {
  const { Preset, Requirements } = await GAuth.load_preset.original();
  const layer = Preset.pipe(
    Layer.provide(
      Layer.succeed(Requirements, {
        GOOGLE_CLIENT_ID: config.client_id,
        GOOGLE_CLIENT_SECRET: config.client_secret,
        REDIRECT_URIS: [redirect_uri],
      }),
    ),
  );
  return await Effect.runPromise(
    Effect.gen(function* () {
      return yield* GAuth.Interface;
    }).pipe(Effect.provide(layer)),
  );
}
