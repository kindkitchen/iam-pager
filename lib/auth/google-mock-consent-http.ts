import type { GoogleMockConsentScreen } from "./google-gauth-composition.ts";

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EXPECTED_SCOPE = "openid email profile";

export interface GoogleMockConsentHttpHandler {
  handle(request: Request): Response;
}

export interface GoogleMockConsentHttpAdapterOptions {
  /** Null outside explicitly configured local Google authentication. */
  readonly screen: GoogleMockConsentScreen | null;
}

/** Development-only HTTP boundary around gauth's package-rendered screen. */
export class GoogleMockConsentHttpAdapter
  implements GoogleMockConsentHttpHandler {
  readonly #screen: GoogleMockConsentScreen | null;

  constructor(options: GoogleMockConsentHttpAdapterOptions) {
    this.#screen = options.screen;
  }

  handle(request: Request): Response {
    if (this.#screen === null) return text_response(404, "not found");
    if (request.method !== "GET") {
      const response = text_response(405, "mock consent requires GET");
      response.headers.set("allow", "GET");
      return response;
    }

    const url = new URL(request.url);
    const state_values = url.searchParams.getAll("state");
    const scope_values = url.searchParams.getAll("scope");
    const redirect_values = url.searchParams.getAll("redirect_uri");
    if (
      [...url.searchParams].length !== 3 || state_values.length !== 1 ||
      !STATE_PATTERN.test(state_values[0]) || scope_values.length !== 1 ||
      scope_values[0] !== EXPECTED_SCOPE || redirect_values.length !== 1 ||
      !this.#screen.allows(url, redirect_values[0])
    ) {
      return text_response(400, "invalid mock consent request");
    }

    try {
      return new Response(
        this.#screen.render(state_values[0], redirect_values[0]),
        {
          status: 200,
          headers: response_headers({
            "content-type": "text/html; charset=utf-8",
            "content-security-policy":
              "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
            "x-content-type-options": "nosniff",
            "x-robots-tag": "noindex",
          }),
        },
      );
    } catch {
      return text_response(500, "mock consent could not be rendered");
    }
  }
}

function text_response(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: response_headers({
      "content-type": "text/plain; charset=utf-8",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    }),
  });
}

function response_headers(initial: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  return headers;
}
