import type { Session } from "../session/model.ts";
import type { SessionResolution } from "../session/model.ts";
import type { AuthenticationOrchestrator } from "./interfaces.ts";
import {
  type AuthenticationCallbackResult,
  type AuthenticationStartResult,
  is_authentication_strategy_id,
} from "./model.ts";

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_CALLBACK_CODE_LENGTH = 4096;

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
  | `callback_${Exclude<AuthenticationCallbackResult, { ok: true }>["reason"]}`;

export interface AuthenticationHttpFailure {
  readonly request_id: string;
  readonly strategy_id: string;
  readonly category: AuthenticationHttpFailureCategory;
}

/** Security-conscious diagnostics surface: secrets and raw causes are absent. */
export interface AuthenticationHttpLogger {
  failure(event: AuthenticationHttpFailure): void;
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
}

export interface AuthenticationHttpAdapterOptions {
  readonly authentication: AuthenticationOrchestrator;
  readonly logger: AuthenticationHttpLogger;
}

export class AuthenticationHttpAdapter implements AuthenticationHttpHandler {
  readonly #authentication: AuthenticationOrchestrator;
  readonly #logger: AuthenticationHttpLogger;

  constructor(options: AuthenticationHttpAdapterOptions) {
    this.#authentication = options.authentication;
    this.#logger = options.logger;
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
      return this.#failure(
        context,
        strategy_id,
        "callback_invalid_query",
        400,
        "invalid authentication callback",
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
      return this.#failure(
        context,
        strategy_id,
        "callback_internal_failure",
        500,
        "authentication could not be completed",
      );
    }

    if (!result.ok) return this.#callback_failure(context, strategy_id, result);
    return {
      response: redirect_response(result.value.return_to),
      session_resolution: result.value.session_resolution,
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
    const mapping = result.reason === "unknown_strategy"
      ? { status: 404, message: "authentication strategy not found" }
      : result.reason === "provider_failure"
      ? { status: 502, message: "authentication could not be completed" }
      : result.reason === "invalid_attempt" ||
          result.reason === "invalid_callback"
      ? { status: 400, message: "invalid authentication callback" }
      : { status: 409, message: "authentication session is no longer valid" };
    return this.#failure(
      context,
      strategy_id,
      `callback_${result.reason}`,
      mapping.status,
      mapping.message,
    );
  }

  #failure(
    context: AuthenticationHttpRequestContext,
    strategy_id: string,
    category: AuthenticationHttpFailureCategory,
    status: number,
    message: string,
  ): AuthenticationHttpResult {
    this.#logger.failure({
      request_id: context.request_id,
      strategy_id,
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
