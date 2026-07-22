import type { GoogleMockConsentScreen } from "../auth/google-gauth-composition.ts";
import { google_drive_file_scope } from "./google-drive-oauth.ts";

const state_pattern = /^[A-Za-z0-9_-]{43}$/;
const expected_scope = `openid email profile ${google_drive_file_scope}`;

export class GoogleDriveMockConsentHttpAdapter {
  readonly #screen: GoogleMockConsentScreen | null;

  constructor(screen: GoogleMockConsentScreen | null) {
    this.#screen = screen;
  }

  handle(request: Request): Response {
    if (this.#screen === null) return text_response(404, "not found");
    if (request.method !== "GET") {
      const response = text_response(405, "mock consent requires GET");
      response.headers.set("allow", "GET");
      return response;
    }
    const url = new URL(request.url);
    const state = url.searchParams.getAll("state");
    const scope = url.searchParams.getAll("scope");
    const redirect_uri = url.searchParams.getAll("redirect_uri");
    const access_type = url.searchParams.getAll("access_type");
    const prompt = url.searchParams.getAll("prompt");
    if (
      [...url.searchParams].length !== 5 || state.length !== 1 ||
      !state_pattern.test(state[0]) || scope.length !== 1 ||
      scope[0] !== expected_scope || redirect_uri.length !== 1 ||
      access_type.length !== 1 || access_type[0] !== "offline" ||
      prompt.length !== 1 || prompt[0] !== "consent" ||
      !this.#screen.allows(url, redirect_uri[0])
    ) return text_response(400, "invalid mock consent request");
    try {
      return new Response(this.#screen.render(state[0], redirect_uri[0]), {
        headers: response_headers("text/html; charset=utf-8", true),
      });
    } catch {
      return text_response(500, "mock consent could not be rendered");
    }
  }
}

function text_response(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: response_headers("text/plain; charset=utf-8", false),
  });
}

function response_headers(content_type: string, allows_form: boolean): Headers {
  return new Headers({
    "content-type": content_type,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "content-security-policy": allows_form
      ? "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
      : "default-src 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex",
  });
}
