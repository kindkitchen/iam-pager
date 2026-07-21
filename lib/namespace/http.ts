import {
  type ApiOperationPolicy,
  type ApiRequestAuthenticator,
  BearerFirstApiRequestAuthenticator,
  PermissionApiOperationPolicy,
} from "../api-auth/mod.ts";
import {
  is_json_media_type,
  read_bounded_request_text,
} from "../http/request-body.ts";
import type { Session } from "../session/model.ts";
import type { LocatorEngine } from "../locator/mod.ts";
import type { NamespaceReservationManager } from "./interfaces.ts";
import { type NamespaceReservation, sort_reservations } from "./model.ts";

/** Keeps authenticated JSON parsing bounded before namespace validation runs. */
export const reserve_namespace_request_max_bytes = 4 * 1024;

/** Request-scoped facts the adapter needs; `AppRequestContext` satisfies it. */
export interface NamespaceHttpRequestContext {
  readonly request_id: string;
  readonly session: Session;
}

/**
 * HTTP boundary for namespace ownership. Reservation
 * rules stay in `NamespaceReservationManager`; this surface only enforces
 * the JSON contract, session and CSRF requirements, and typed mapping.
 */
export interface NamespaceHttpHandler {
  /** Authenticated create; the CSRF synchronizer token rides in the body. */
  reserve(
    request: Request,
    context: NamespaceHttpRequestContext,
  ): Promise<Response>;
  /** Authenticated read of the caller's reservations, oldest first. */
  list_owned(
    request: Request,
    context: NamespaceHttpRequestContext,
  ): Promise<Response>;
}

export interface NamespaceHttpAdapterOptions {
  readonly namespaces: NamespaceReservationManager;
  readonly engine: LocatorEngine;
  /** Absent means fail closed: every explicit bearer is rejected. */
  readonly authenticator?: ApiRequestAuthenticator;
  readonly policy?: ApiOperationPolicy;
}

interface ReserveBody {
  namespace: string;
  /** Required for browser callers, meaningless for key principals. */
  csrf_token?: string;
}

type BodyDecodeResult =
  | { ok: true; value: ReserveBody }
  | { ok: false; detail: string };

/** Adapter over the reservation manager; owns no namespace rules itself. */
export class NamespaceHttpAdapter implements NamespaceHttpHandler {
  readonly #namespaces: NamespaceReservationManager;
  readonly #engine: LocatorEngine;
  readonly #authenticator: ApiRequestAuthenticator;
  readonly #policy: ApiOperationPolicy;

  constructor(options: NamespaceHttpAdapterOptions) {
    this.#namespaces = options.namespaces;
    this.#engine = options.engine;
    this.#authenticator = options.authenticator ??
      new BearerFirstApiRequestAuthenticator();
    this.#policy = options.policy ?? new PermissionApiOperationPolicy();
  }

  async reserve(
    request: Request,
    context: NamespaceHttpRequestContext,
  ): Promise<Response> {
    const auth = await this.#authenticator.authenticate(
      request,
      context.session,
    );
    if (!auth.ok) return bearer_challenge_response();
    const principal = auth.principal;
    if (principal.kind === "guest") {
      return error_response(
        401,
        "not_authenticated",
        "namespace reservation requires a signed-in creator",
      );
    }
    if (!is_json_media_type(request.headers.get("content-type"))) {
      return error_response(
        415,
        "unsupported_media_type",
        "content-type must be application/json",
      );
    }

    const body_read = await read_bounded_request_text(
      request,
      reserve_namespace_request_max_bytes,
    );
    if (!body_read.ok) {
      return body_read.reason === "too_large"
        ? error_response(
          413,
          "request_too_large",
          `request body exceeds ${reserve_namespace_request_max_bytes} bytes`,
        )
        : error_response(400, "invalid_json", "request body could not be read");
    }

    let input: unknown;
    try {
      input = JSON.parse(body_read.text);
    } catch {
      return error_response(
        400,
        "invalid_json",
        "request body is not valid JSON",
      );
    }
    const decoded = decode_reserve_body(input);
    if (!decoded.ok) {
      return error_response(400, "invalid_request", decoded.detail);
    }
    const authorized = this.#policy.authorize(principal, {
      permission: "write",
      presented_csrf_token: decoded.value.csrf_token ?? null,
    });
    if (!authorized.ok) {
      return authorized.reason === "invalid_csrf"
        ? error_response(
          403,
          "invalid_csrf",
          "reservation could not be authorized",
        )
        : error_response(
          403,
          "insufficient_permission",
          "namespace reservation requires the write permission",
        );
    }

    const result = await this.#namespaces.reserve({
      namespace: decoded.value.namespace,
      owner_user_id: authorized.user_id,
    });
    if (!result.ok) return reserve_failure_response(result.reason);
    return json_response(
      201,
      { ok: true, reservation: this.#present(result.reservation) },
      {
        location: this.#engine.format({
          namespace: result.reservation.namespace,
        }),
      },
    );
  }

  async list_owned(
    request: Request,
    context: NamespaceHttpRequestContext,
  ): Promise<Response> {
    const auth = await this.#authenticator.authenticate(
      request,
      context.session,
    );
    if (!auth.ok) return bearer_challenge_response();
    const authorized = this.#policy.authorize(auth.principal, {
      permission: "read",
    });
    if (!authorized.ok) {
      return authorized.reason === "insufficient_permission"
        ? error_response(
          403,
          "insufficient_permission",
          "namespace listing requires the read permission",
        )
        : error_response(
          401,
          "not_authenticated",
          "namespace listing requires a signed-in creator",
        );
    }
    const owned = await this.#namespaces.list_owned(authorized.user_id);
    return json_response(200, {
      ok: true,
      reservations: sort_reservations(owned).map((reservation) =>
        this.#present(reservation)
      ),
    });
  }

  /** Public wire shape: spelling, direct path, and reservation time. */
  #present(reservation: NamespaceReservation): {
    namespace: string;
    path: string;
    reserved_at: string;
  } {
    return {
      namespace: reservation.namespace,
      path: this.#engine.format({ namespace: reservation.namespace }),
      reserved_at: reservation.reserved_at.toISOString(),
    };
  }
}

function decode_reserve_body(input: unknown): BodyDecodeResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, detail: "request body must be an object" };
  }
  const { namespace, csrf_token } = input as Record<string, unknown>;
  if (typeof namespace !== "string") {
    return { ok: false, detail: "namespace must be a string" };
  }
  if (csrf_token !== undefined && typeof csrf_token !== "string") {
    return { ok: false, detail: "csrf_token must be a string" };
  }
  return {
    ok: true,
    value: {
      namespace,
      ...(csrf_token === undefined ? {} : { csrf_token }),
    },
  };
}

function reserve_failure_response(
  reason: "invalid_namespace" | "forbidden_namespace" | "taken",
): Response {
  switch (reason) {
    case "invalid_namespace":
      return error_response(
        422,
        reason,
        "namespace cannot be mapped to a direct URL",
      );
    case "forbidden_namespace":
      return error_response(
        403,
        reason,
        "namespace is reserved by the platform",
      );
    case "taken":
      return error_response(
        409,
        reason,
        "namespace is already reserved",
      );
  }
}

/** One non-disclosing challenge for every unusable explicit bearer. */
function bearer_challenge_response(): Response {
  return json_response(
    401,
    {
      ok: false,
      error: "invalid_bearer",
      detail: "the request could not be authenticated",
    },
    { "www-authenticate": 'Bearer realm="api"' },
  );
}

function error_response(
  status: number,
  error: string,
  detail: string,
): Response {
  return json_response(status, { ok: false, error, detail });
}

function json_response(
  status: number,
  body: unknown,
  extra_headers?: HeadersInit,
): Response {
  const headers = new Headers(extra_headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}
