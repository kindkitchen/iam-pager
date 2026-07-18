import { GAuth } from "@kindkitchen/gauth";
import { Effect, Layer } from "effect";
import type { GAuthService } from "./google-gauth-strategy.ts";

export const GOOGLE_AUTH_MODE_ENV = "IAM_PAGER_GOOGLE_AUTH_MODE";
export const GOOGLE_AUTH_REDIRECT_URI_ENV =
  "IAM_PAGER_GOOGLE_AUTH_REDIRECT_URI";
export const GOOGLE_AUTH_MOCK_CONSENT_URL_ENV =
  "IAM_PAGER_GOOGLE_AUTH_MOCK_CONSENT_URL";
export const GOOGLE_AUTH_CLIENT_ID_ENV = "IAM_PAGER_GOOGLE_AUTH_CLIENT_ID";
export const GOOGLE_AUTH_CLIENT_SECRET_ENV =
  "IAM_PAGER_GOOGLE_AUTH_CLIENT_SECRET";

export interface EnvironmentSource {
  get(name: string): string | undefined;
}

export interface LocalGoogleAuthConfig {
  readonly mode: "local";
  readonly redirect_uri: string;
  readonly mocked_google_consent_screen_url: string;
}

export interface OriginalGoogleAuthConfig {
  readonly mode: "original";
  readonly redirect_uri: string;
  readonly client_id: string;
  readonly client_secret: string;
}

export type GoogleAuthConfig =
  | LocalGoogleAuthConfig
  | OriginalGoogleAuthConfig;

/** Package-owned local consent rendering kept behind an application interface. */
export interface GoogleMockConsentScreen {
  readonly callback_url: string;
  render(state: string): string;
}

export interface GoogleGAuthComposition {
  readonly service: GAuthService;
  readonly mock_consent_screen: GoogleMockConsentScreen | null;
}

class PackageGoogleMockConsentScreen implements GoogleMockConsentScreen {
  readonly callback_url: string;
  readonly #render_consent_screen: (
    input: { state: string; redirect_uri: string },
  ) => string;

  constructor(
    callback_url: string,
    render_consent_screen: (
      input: { state: string; redirect_uri: string },
    ) => string,
  ) {
    this.callback_url = callback_url;
    this.#render_consent_screen = render_consent_screen;
  }

  render(state: string): string {
    return this.#render_consent_screen({
      state,
      redirect_uri: this.callback_url,
    });
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

/** Reads and validates one explicit gauth preset configuration. */
export function parse_google_auth_config(
  environment: EnvironmentSource,
): GoogleAuthConfig {
  const mode = require_environment_value(environment, GOOGLE_AUTH_MODE_ENV);
  if (mode !== "local" && mode !== "original") {
    throw new TypeError(`${GOOGLE_AUTH_MODE_ENV} must be local or original`);
  }

  const redirect_uri = require_environment_value(
    environment,
    GOOGLE_AUTH_REDIRECT_URI_ENV,
  );
  const redirect_url = parse_callback_url(redirect_uri);

  if (mode === "local") {
    const mocked_google_consent_screen_url = require_environment_value(
      environment,
      GOOGLE_AUTH_MOCK_CONSENT_URL_ENV,
    );
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
    return {
      mode,
      redirect_uri,
      mocked_google_consent_screen_url,
    };
  }

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
  };
}

/** Loads only the selected preset and returns its application adapters. */
export async function compose_google_gauth(
  config: GoogleAuthConfig,
): Promise<GoogleGAuthComposition> {
  if (config.mode === "local") {
    const { Preset, Requirements } = await GAuth.load_preset.local();
    const layer = Preset.pipe(
      Layer.provide(
        Layer.succeed(Requirements, {
          REDIRECT_URI: config.redirect_uri,
          MOCKED_GOOGLE_CONSENT_SCREEN_URL:
            config.mocked_google_consent_screen_url,
        }),
      ),
    );
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* GAuth.Interface;
      }).pipe(Effect.provide(layer)),
    );
    return {
      service,
      mock_consent_screen: new PackageGoogleMockConsentScreen(
        config.redirect_uri,
        (input) => Requirements.render_consent_screen(input),
      ),
    };
  }

  const { Preset, Requirements } = await GAuth.load_preset.original();
  const layer = Preset.pipe(
    Layer.provide(
      Layer.succeed(Requirements, {
        GOOGLE_CLIENT_ID: config.client_id,
        GOOGLE_CLIENT_SECRET: config.client_secret,
        REDIRECT_URIS: [config.redirect_uri],
      }),
    ),
  );
  const service = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* GAuth.Interface;
    }).pipe(Effect.provide(layer)),
  );
  return {
    service,
    mock_consent_screen: null,
  };
}

/** Compatibility surface for callers needing only the provider service. */
export async function compose_google_gauth_service(
  config: GoogleAuthConfig,
): Promise<GAuthService> {
  return (await compose_google_gauth(config)).service;
}
