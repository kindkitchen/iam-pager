import type { AuthenticationCallbackUrlResolver } from "../auth/authentication-callback-url.ts";
import { RequestOriginAuthenticationCallbackUrlResolver } from "../auth/authentication-callback-url.ts";
import { csrf_tokens_match } from "../http/csrf.ts";
import { read_bounded_request_text } from "../http/request-body.ts";
import type { AppRequestContext } from "../request-context.ts";
import type { GoogleDriveConnectionManager } from "./google-drive-connection-service.ts";

const state_pattern = /^[A-Za-z0-9_-]{43}$/;
const max_code_length = 4096;
const max_callback_parameter_count = 16;
const max_callback_parameter_name_length = 64;
const max_callback_parameter_value_length = 4096;
const google_accounts_issuer = "https://accounts.google.com";
const max_disconnect_body_bytes = 256;

export interface GoogleDriveConnectionHttpHandler {
  start(request: Request, context: AppRequestContext): Promise<Response>;
  callback(request: Request, context: AppRequestContext): Promise<Response>;
  disconnect(request: Request, context: AppRequestContext): Promise<Response>;
}

export class GoogleDriveConnectionHttpAdapter
  implements GoogleDriveConnectionHttpHandler {
  readonly #connections: GoogleDriveConnectionManager;
  readonly #callback_url_resolver: AuthenticationCallbackUrlResolver;

  constructor(options: {
    connections: GoogleDriveConnectionManager;
    callback_url_resolver?: AuthenticationCallbackUrlResolver;
  }) {
    this.#connections = options.connections;
    this.#callback_url_resolver = options.callback_url_resolver ??
      new RequestOriginAuthenticationCallbackUrlResolver();
  }

  async start(request: Request, context: AppRequestContext): Promise<Response> {
    if (context.session.kind !== "authenticated") {
      return text_response(401, "authentication required");
    }
    let callback_url: string | null;
    try {
      callback_url = this.#callback_url_resolver.resolve(
        request,
        "storage/google-drive",
      );
    } catch {
      return text_response(500, "Google Drive connection could not be started");
    }
    if (callback_url === null) {
      return text_response(400, "invalid Google Drive connection request");
    }
    const result = await this.#connections.start(context.session, callback_url);
    if (!result.ok) return failure_response(result.reason, "start");
    return redirect_response(result.value.authorization_url);
  }

  async callback(
    request: Request,
    context: AppRequestContext,
  ): Promise<Response> {
    if (context.session.kind !== "authenticated") {
      return text_response(401, "authentication required");
    }
    const url = new URL(request.url);
    const states = url.searchParams.getAll("state");
    const codes = url.searchParams.getAll("code");
    if (states.length !== 1 || !state_pattern.test(states[0])) {
      return failure_page(400);
    }
    // Consume a recognizable state even when the provider callback is malformed.
    const code = codes.length === 1 && codes[0].length > 0 &&
        codes[0].length <= max_code_length &&
        has_valid_callback_parameters(url)
      ? codes[0]
      : "";
    const result = await this.#connections.complete(
      context.session,
      states[0],
      code,
    );
    if (!result.ok) return failure_response(result.reason, "callback");
    return redirect_response("/site/manage?storage=google-drive-connected");
  }

  async disconnect(
    request: Request,
    context: AppRequestContext,
  ): Promise<Response> {
    if (context.session.kind !== "authenticated") {
      return text_response(401, "authentication required");
    }
    if (request.method !== "POST") {
      const response = text_response(405, "disconnect requires POST");
      response.headers.set("allow", "POST");
      return response;
    }
    if (
      request.headers.get("content-type")?.split(";", 1)[0].trim()
        .toLowerCase() !== "application/x-www-form-urlencoded"
    ) return text_response(415, "disconnect requires form data");
    const body = await read_bounded_request_text(
      request,
      max_disconnect_body_bytes,
    );
    if (!body.ok) return text_response(400, "invalid disconnect request");
    const form = new URLSearchParams(body.text);
    const csrf_tokens = form.getAll("csrf_token");
    if (
      csrf_tokens.length !== 1 ||
      [...form.keys()].some((key) => key !== "csrf_token") ||
      !csrf_tokens_match(context.session.csrf_token, csrf_tokens[0])
    ) return text_response(403, "disconnect could not be authorized");
    const result = await this.#connections.disconnect(context.session);
    if (!result.ok) return failure_response(result.reason, "disconnect");
    return redirect_response("/site/manage?storage=google-drive-disconnected");
  }
}

function failure_response(
  reason: string,
  operation: "start" | "callback" | "disconnect",
): Response {
  if (reason === "not_authenticated") {
    return text_response(401, "authentication required");
  }
  if (operation === "callback") {
    return failure_page(reason === "provider_failure" ? 502 : 400);
  }
  return text_response(
    reason === "provider_failure"
      ? 502
      : reason === "invalid_attempt"
      ? 404
      : 409,
    `Google Drive ${operation} failed`,
  );
}

function failure_page(status: number): Response {
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"><title>Connection failed | iam-pager</title></head>
<body><main><h1>Google Drive connection failed</h1><p>Your existing storage connection is unchanged.</p><p><a href="/auth/storage/google-drive/start">Try again</a></p><p><a href="/site/manage">Return to management</a></p></main></body></html>\n`,
    {
      status,
      headers: response_headers("text/html; charset=utf-8"),
    },
  );
}

function has_valid_callback_parameters(url: URL): boolean {
  const parameters = [...url.searchParams];
  if (
    parameters.length > max_callback_parameter_count ||
    parameters.some(([name, value]) =>
      name.length === 0 || name.length > max_callback_parameter_name_length ||
      value.length > max_callback_parameter_value_length
    )
  ) return false;

  const issuers = url.searchParams.getAll("iss");
  return issuers.length === 0 ||
    (issuers.length === 1 && issuers[0] === google_accounts_issuer);
}

function redirect_response(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { ...Object.fromEntries(response_headers(null)), location },
  });
}

function text_response(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: response_headers("text/plain; charset=utf-8"),
  });
}

function response_headers(content_type: string | null): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'none'; img-src 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
  });
  if (content_type !== null) headers.set("content-type", content_type);
  return headers;
}
