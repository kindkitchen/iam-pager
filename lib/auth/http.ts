import { read_bounded_request_text } from "../http/request-body.ts";
import type { SessionLogoutManager } from "../session/interfaces.ts";
import type {
  Session,
  SessionLogoutResult,
  SessionResolution,
} from "../session/model.ts";
import type { AuthenticationOrchestrator } from "./interfaces.ts";
import {
  type AuthenticationCallbackResult,
  type AuthenticationStartResult,
  is_authentication_strategy_id,
  normalize_authentication_return_to,
} from "./model.ts";

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_CALLBACK_CODE_LENGTH = 4096;
const MAX_LOGOUT_BODY_BYTES = 256;

export interface AuthenticationHttpRequestContext {
  readonly request_id: string;
  readonly session: Session;
}

/** A response plus any newer session that the request boundary must publish. */
export interface AuthenticationHttpResult {
  readonly response: Response;
  readonly session_resolution?: SessionResolution;
}

export type AuthenticationHttpFailureCategory =
  | "start_invalid_query"
  | "start_internal_failure"
  | `start_${Exclude<AuthenticationStartResult, { ok: true }>["reason"]}`
  | "callback_invalid_query"
  | "callback_internal_failure"
  | `callback_${Exclude<AuthenticationCallbackResult, { ok: true }>["reason"]}`
  | "logout_invalid_request"
  | "logout_internal_failure"
  | `logout_${Exclude<SessionLogoutResult, { ok: true }>["reason"]}`;

export interface AuthenticationHttpFailure {
  readonly request_id: string;
  readonly strategy_id?: string;
  readonly category: AuthenticationHttpFailureCategory;
}

/** Security-conscious diagnostics surface: secrets and raw causes are absent. */
export interface AuthenticationHttpLogger {
  failure(event: AuthenticationHttpFailure): void;
}

export interface AuthenticationCallbackFailureView {
  readonly title: string;
  readonly heading: string;
  readonly message: string;
  readonly retry_href: string;
  readonly retry_label: string;
  readonly return_href: string;
  readonly return_label: string;
}

/** Provider-neutral model for the site-owned callback recovery page. */
export interface AuthenticationCallbackFailurePresenter {
  present(strategy_id: string): AuthenticationCallbackFailureView;
}

export class SiteAuthenticationCallbackFailurePresenter
  implements AuthenticationCallbackFailurePresenter {
  present(strategy_id: string): AuthenticationCallbackFailureView {
    if (!is_authentication_strategy_id(strategy_id)) {
      throw new TypeError("callback retry requires a valid strategy ID");
    }
    return {
      title: "Sign-in failed | iam-pager",
      heading: "Sign-in failed",
      message:
        "Sign-in could not be completed. Your current session is unchanged.",
      retry_href: `/auth/${strategy_id}/start`,
      retry_label: "Try sign-in again",
      return_href: "/",
      return_label: "Return to iam-pager",
    };
  }
}

/** Fresh-independent browser start/callback boundary. */
export interface AuthenticationHttpHandler {
  start(
    request: Request,
    strategy_id: string,
    context: AuthenticationHttpRequestContext,
  ): Promise<AuthenticationHttpResult>;
  callback(
    request: Request,
    strategy_id: string,
    context: AuthenticationHttpRequestContext,
  ): Promise<AuthenticationHttpResult>;
  logout(
    request: Request,
    context: AuthenticationHttpRequestContext,
  ): Promise<AuthenticationHttpResult>;
}

export interface AuthenticationHttpAdapterOptions {
  readonly authentication: AuthenticationOrchestrator;
  readonly sessions: SessionLogoutManager;
  readonly logger: AuthenticationHttpLogger;
  readonly callback_failure_presenter: AuthenticationCallbackFailurePresenter;
}

export class AuthenticationHttpAdapter implements AuthenticationHttpHandler {
  readonly #authentication: AuthenticationOrchestrator;
  readonly #sessions: SessionLogoutManager;
  readonly #logger: AuthenticationHttpLogger;
  readonly #callback_failure_presenter: AuthenticationCallbackFailurePresenter;

  constructor(options: AuthenticationHttpAdapterOptions) {
    this.#authentication = options.authentication;
    this.#sessions = options.sessions;
    this.#logger = options.logger;
    this.#callback_failure_presenter = options.callback_failure_presenter;
  }

  async start(
    request: Request,
    strategy_id: string,
    context: AuthenticationHttpRequestContext,
  ): Promise<AuthenticationHttpResult> {
    if (!is_authentication_strategy_id(strategy_id)) {
      return this.#failure(
        context,
        "invalid",
        "start_unknown_strategy",
        404,
        "authentication strategy not found",
      );
    }

    const request_url = new URL(request.url);
    const return_values = request_url.searchParams.getAll("return_to");
    if (return_values.length > 1) {
      return this.#failure(
        context,
        strategy_id,
        "start_invalid_query",
        400,
        "invalid authentication request",
      );
    }

    let result: AuthenticationStartResult;
    try {
      result = await this.#authentication.start({
        session: context.session,
        strategy_id,
        callback_url: new URL(
          `/auth/${strategy_id}/callback`,
          request_url.origin,
        ).href,
        return_to: return_values[0],
      });
    } catch {
      return this.#failure(
        context,
        strategy_id,
        "start_internal_failure",
        500,
        "authentication could not be started",
      );
    }

    if (!result.ok) return this.#start_failure(context, strategy_id, result);
    return { response: redirect_response(result.value.authorization_url) };
  }

  async callback(
    request: Request,
    strategy_id: string,
    context: AuthenticationHttpRequestContext,
  ): Promise<AuthenticationHttpResult> {
    if (!is_authentication_strategy_id(strategy_id)) {
      return this.#failure(
        context,
        "invalid",
        "callback_unknown_strategy",
        404,
        "authentication strategy not found",
      );
    }

    const request_url = new URL(request.url);
    const state_values = request_url.searchParams.getAll("state");
    if (
      state_values.length !== 1 || !STATE_PATTERN.test(state_values[0])
    ) {
      return this.#callback_presentation_failure(
        context,
        strategy_id,
        "callback_invalid_query",
        400,
      );
    }

    const code_values = request_url.searchParams.getAll("code");
    // A recognizable state is deliberately consumed even when code is absent,
    // duplicated, or oversized. It must not remain reusable after a callback.
    const code = code_values.length === 1 &&
        code_values[0].length <= MAX_CALLBACK_CODE_LENGTH
      ? code_values[0]
      : "";

    let result: AuthenticationCallbackResult;
    try {
      result = await this.#authentication.complete({
        session: context.session,
        strategy_id,
        code,
        state: state_values[0],
      });
    } catch {
      return this.#callback_presentation_failure(
        context,
        strategy_id,
        "callback_internal_failure",
        500,
      );
    }

    if (!result.ok) return this.#callback_failure(context, strategy_id, result);
    return {
      response: redirect_response(result.value.return_to),
      session_resolution: result.value.session_resolution,
    };
  }

  async logout(
    request: Request,
    context: AuthenticationHttpRequestContext,
  ): Promise<AuthenticationHttpResult> {
    if (request.method !== "POST") {
      const result = this.#failure(
        context,
        undefined,
        "logout_invalid_request",
        405,
        "logout requires POST",
      );
      result.response.headers.set("allow", "POST");
      return result;
    }
    if (!is_form_media_type(request.headers.get("content-type"))) {
      return this.#failure(
        context,
        undefined,
        "logout_invalid_request",
        415,
        "logout requires form data",
      );
    }

    const body = await read_bounded_request_text(
      request,
      MAX_LOGOUT_BODY_BYTES,
    );
    if (!body.ok) {
      return this.#failure(
        context,
        undefined,
        "logout_invalid_request",
        body.reason === "too_large" ? 413 : 400,
        "invalid logout request",
      );
    }
    const form = new URLSearchParams(body.text);
    const csrf_tokens = form.getAll("csrf_token");
    if (
      csrf_tokens.length !== 1 ||
      [...form.keys()].some((name) => name !== "csrf_token")
    ) {
      return this.#failure(
        context,
        undefined,
        "logout_invalid_request",
        400,
        "invalid logout request",
      );
    }

    let result: SessionLogoutResult;
    try {
      result = await this.#sessions.logout(
        context.session,
        csrf_tokens[0],
      );
    } catch {
      return this.#failure(
        context,
        undefined,
        "logout_internal_failure",
        500,
        "logout could not be completed",
      );
    }
    if (!result.ok) return this.#logout_failure(context, result);
    return {
      response: redirect_response("/"),
      session_resolution: result.resolution,
    };
  }

  #start_failure(
    context: AuthenticationHttpRequestContext,
    strategy_id: string,
    result: Exclude<AuthenticationStartResult, { ok: true }>,
  ): AuthenticationHttpResult {
    const mapping = result.reason === "unknown_strategy"
      ? { status: 404, message: "authentication strategy not found" }
      : result.reason === "provider_failure"
      ? { status: 502, message: "authentication provider is unavailable" }
      : result.reason === "invalid_return_to" ||
          result.reason === "invalid_callback_url"
      ? { status: 400, message: "invalid authentication request" }
      : { status: 409, message: "authentication session is no longer valid" };
    return this.#failure(
      context,
      strategy_id,
      `start_${result.reason}`,
      mapping.status,
      mapping.message,
    );
  }

  #callback_failure(
    context: AuthenticationHttpRequestContext,
    strategy_id: string,
    result: Exclude<AuthenticationCallbackResult, { ok: true }>,
  ): AuthenticationHttpResult {
    if (result.reason === "unknown_strategy") {
      return this.#failure(
        context,
        strategy_id,
        "callback_unknown_strategy",
        404,
        "authentication strategy not found",
      );
    }
    const status = result.reason === "provider_failure"
      ? 502
      : result.reason === "invalid_attempt" ||
          result.reason === "invalid_callback"
      ? 400
      : 409;
    return this.#callback_presentation_failure(
      context,
      strategy_id,
      `callback_${result.reason}`,
      status,
    );
  }

  #callback_presentation_failure(
    context: AuthenticationHttpRequestContext,
    strategy_id: string,
    category: AuthenticationHttpFailureCategory,
    status: number,
  ): AuthenticationHttpResult {
    this.#logger.failure({
      request_id: context.request_id,
      strategy_id,
      category,
    });
    return {
      response: callback_failure_response(
        status,
        this.#callback_failure_presenter.present(strategy_id),
      ),
    };
  }

  #logout_failure(
    context: AuthenticationHttpRequestContext,
    result: Exclude<SessionLogoutResult, { ok: true }>,
  ): AuthenticationHttpResult {
    const mapping = result.reason === "invalid_csrf"
      ? { status: 403, message: "logout could not be authorized" }
      : { status: 409, message: "authentication session is no longer valid" };
    return this.#failure(
      context,
      undefined,
      `logout_${result.reason}`,
      mapping.status,
      mapping.message,
    );
  }

  #failure(
    context: AuthenticationHttpRequestContext,
    strategy_id: string | undefined,
    category: AuthenticationHttpFailureCategory,
    status: number,
    message: string,
  ): AuthenticationHttpResult {
    this.#logger.failure({
      request_id: context.request_id,
      ...(strategy_id === undefined ? {} : { strategy_id }),
      category,
    });
    return { response: text_response(status, message) };
  }
}

export class ConsoleAuthenticationHttpLogger
  implements AuthenticationHttpLogger {
  failure(event: AuthenticationHttpFailure): void {
    console.warn(JSON.stringify({ event: "authentication_failure", ...event }));
  }
}

function redirect_response(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: response_headers({ location }),
  });
}

function text_response(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: restrictive_content_headers("text/plain; charset=utf-8"),
  });
}

function callback_failure_response(
  status: number,
  view: AuthenticationCallbackFailureView,
): Response {
  const retry_href = safe_local_href(view.retry_href);
  const return_href = safe_local_href(view.return_href);
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape_html(view.title)}</title>
</head>
<body>
  <main>
    <h1>${escape_html(view.heading)}</h1>
    <p>${escape_html(view.message)}</p>
    <p><a href="${escape_html(retry_href)}">${
    escape_html(view.retry_label)
  }</a></p>
    <p><a href="${escape_html(return_href)}">${
    escape_html(view.return_label)
  }</a></p>
  </main>
</body>
</html>
`;
  return new Response(body, {
    status,
    headers: restrictive_content_headers("text/html; charset=utf-8"),
  });
}

function restrictive_content_headers(content_type: string): Headers {
  return response_headers({
    "content-type": content_type,
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
  });
}

function safe_local_href(value: string): string {
  return normalize_authentication_return_to(value) ?? "/";
}

function escape_html(value: string): string {
  return value.replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function is_form_media_type(content_type: string | null): boolean {
  return content_type?.split(";", 1)[0].trim().toLowerCase() ===
    "application/x-www-form-urlencoded";
}

function response_headers(initial: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  return headers;
}
