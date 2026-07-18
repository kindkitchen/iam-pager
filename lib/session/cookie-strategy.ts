import { getCookies, setCookie } from "@std/http/cookie";
import type { SessionTransport } from "./interfaces.ts";
import type { SessionCredential } from "./model.ts";

export type SessionCookieMode = "local" | "production";

export interface SessionCookieConfig {
  readonly name: string;
  readonly secure: boolean;
}

const production_config: SessionCookieConfig = {
  name: "__Host-iam_pager_session",
  secure: true,
};

const local_config: SessionCookieConfig = {
  name: "iam_pager_session_local",
  secure: false,
};

/** Cookie security may be weakened only by explicitly selecting local mode. */
export function session_cookie_config(
  mode: SessionCookieMode,
): SessionCookieConfig {
  return { ...(mode === "local" ? local_config : production_config) };
}

/**
 * Host-only opaque session transport. Identity and lifecycle state remain in
 * the SessionRepository; the cookie contains only the rotatable bearer.
 */
export class CookieSessionStrategy implements SessionTransport {
  readonly #config: SessionCookieConfig;

  constructor(config: SessionCookieConfig) {
    validate_config(config);
    this.#config = { ...config };
  }

  extract(request: Request): string | null {
    try {
      return getCookies(request.headers)[this.#config.name] ?? null;
    } catch {
      return null;
    }
  }

  attach(response: Response, credential: SessionCredential): Response {
    return with_headers(response, (headers) => {
      setCookie(headers, {
        name: this.#config.name,
        value: credential.value,
        expires: new Date(credential.expires_at),
        httpOnly: true,
        secure: this.#config.secure,
        sameSite: "Lax",
        path: "/",
      });
    });
  }

  expire(response: Response): Response {
    return with_headers(response, (headers) => {
      setCookie(headers, {
        name: this.#config.name,
        value: "",
        expires: new Date(0),
        httpOnly: true,
        secure: this.#config.secure,
        sameSite: "Lax",
        path: "/",
      });
    });
  }
}

/** Clone only the response envelope; the original body stream is preserved. */
function with_headers(
  response: Response,
  update: (headers: Headers) => void,
): Response {
  const headers = new Headers(response.headers);
  update(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function validate_config(config: SessionCookieConfig): void {
  if (config.name.length === 0) {
    throw new TypeError("session cookie name must not be empty");
  }
  if (config.name.startsWith("__Host-") && !config.secure) {
    throw new TypeError("__Host- session cookies must be secure");
  }
}
