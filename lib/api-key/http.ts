import { csrf_tokens_match } from "../http/csrf.ts";
import {
  is_json_media_type,
  read_bounded_request_bytes,
  read_bounded_request_text,
} from "../http/request-body.ts";
import { strict_object } from "../http/strict-object.ts";
import type { Session } from "../session/model.ts";
import { format_api_key_etag, parse_api_key_etag } from "./etag.ts";
import type { ApiKeyBearerResolver, ApiKeyManager } from "./interfaces.ts";
import type { ApiKeyMetadata } from "./model.ts";

/** Keeps authenticated JSON parsing bounded before key validation runs. */
export const api_key_request_max_bytes = 4 * 1024;

/** Request-scoped facts the adapter needs; `AppRequestContext` satisfies it. */
export interface ApiKeyHttpRequestContext {
  readonly request_id: string;
  readonly session: Session;
}

/**
 * HTTP boundary for the owner API-key surface. Lifecycle rules stay in
 * `ApiKeyManager`; this adapter only enforces the wire contract:
 *
 * - list/create/inspect/update/individual delete require a browser session;
 *   an explicitly supplied bearer never satisfies them and never falls back
 *   to the cookie.
 * - browser mutations require the `x-csrf-token` synchronizer header;
 *   update and individual delete additionally require a strong `If-Match`.
 * - collection DELETE (revoke-all) is the only bearer-accessible operation
 *   and requires the `delete` permission; it revokes the calling key too.
 * - the bearer appears exactly once, in a successful create response.
 */
export interface ApiKeyHttpHandler {
  list(
    request: Request,
    context: ApiKeyHttpRequestContext,
  ): Promise<Response>;
  create(
    request: Request,
    context: ApiKeyHttpRequestContext,
  ): Promise<Response>;
  revoke_all(
    request: Request,
    context: ApiKeyHttpRequestContext,
  ): Promise<Response>;
  inspect(
    request: Request,
    context: ApiKeyHttpRequestContext,
    api_key_id: string,
  ): Promise<Response>;
  update(
    request: Request,
    context: ApiKeyHttpRequestContext,
    api_key_id: string,
  ): Promise<Response>;
  revoke(
    request: Request,
    context: ApiKeyHttpRequestContext,
    api_key_id: string,
  ): Promise<Response>;
}

export interface ApiKeyHttpAdapterOptions {
  readonly api_keys: ApiKeyManager & ApiKeyBearerResolver;
}

const bearer_scheme_pattern = /^Bearer (\S+)$/;

/** Adapter over the API-key manager; owns no lifecycle rules itself. */
export class ApiKeyHttpAdapter implements ApiKeyHttpHandler {
  readonly #api_keys: ApiKeyManager & ApiKeyBearerResolver;

  constructor(options: ApiKeyHttpAdapterOptions) {
    this.#api_keys = options.api_keys;
  }

  async list(
    request: Request,
    context: ApiKeyHttpRequestContext,
  ): Promise<Response> {
    const gate = this.#browser_gate(request, context, { mutation: false });
    if (!gate.ok) return gate.response;
    const keys = await this.#api_keys.list_owned(gate.user_id);
    return json_response(200, {
      ok: true,
      api_keys: keys.map((key) => present(key)),
    });
  }

  async create(
    request: Request,
    context: ApiKeyHttpRequestContext,
  ): Promise<Response> {
    const gate = this.#browser_gate(request, context, { mutation: true });
    if (!gate.ok) return gate.response;
    const body = await decode_key_body(request, {
      expires_at_required: false,
    });
    if (!body.ok) return body.response;

    const result = await this.#api_keys.create({
      owner_user_id: gate.user_id,
      label: body.label,
      permissions: body.permissions,
      expires_at: body.expires_at,
    });
    if (!result.ok) return validation_failure_response(result);
    return json_response(
      201,
      { ok: true, api_key: present(result.api_key), bearer: result.bearer },
      {
        etag: format_api_key_etag(
          result.api_key.api_key_id,
          result.api_key.revision,
        ),
      },
    );
  }

  async revoke_all(
    request: Request,
    context: ApiKeyHttpRequestContext,
  ): Promise<Response> {
    const body = await read_bounded_request_bytes(request, 0);
    if (!body.ok) {
      return error_response(
        400,
        "invalid_request",
        "revoke-all takes no request body",
      );
    }

    const authorization = request.headers.get("authorization");
    if (authorization !== null) {
      const match = bearer_scheme_pattern.exec(authorization);
      const principal = match === null
        ? null
        : await this.#api_keys.resolve_bearer(match[1]);
      if (principal === null) return bearer_challenge_response();
      if (!principal.permissions.includes("delete")) {
        return error_response(
          403,
          "insufficient_permission",
          "revoke-all requires the delete permission",
        );
      }
      const result = await this.#api_keys.revoke_all(principal.user_id);
      return json_response(200, {
        ok: true,
        revoked_count: result.revoked_count,
      });
    }

    const gate = this.#browser_gate(request, context, { mutation: true });
    if (!gate.ok) return gate.response;
    const result = await this.#api_keys.revoke_all(gate.user_id);
    return json_response(200, {
      ok: true,
      revoked_count: result.revoked_count,
    });
  }

  async inspect(
    request: Request,
    context: ApiKeyHttpRequestContext,
    api_key_id: string,
  ): Promise<Response> {
    const gate = this.#browser_gate(request, context, { mutation: false });
    if (!gate.ok) return gate.response;
    const key = await this.#api_keys.inspect(gate.user_id, api_key_id);
    if (key === null) return not_found_response();
    return json_response(200, { ok: true, api_key: present(key) }, {
      etag: format_api_key_etag(key.api_key_id, key.revision),
    });
  }

  async update(
    request: Request,
    context: ApiKeyHttpRequestContext,
    api_key_id: string,
  ): Promise<Response> {
    const gate = this.#browser_gate(request, context, { mutation: true });
    if (!gate.ok) return gate.response;
    const precondition = decode_precondition(request, api_key_id);
    if (!precondition.ok) return precondition.response;
    const body = await decode_key_body(request, { expires_at_required: true });
    if (!body.ok) return body.response;

    const result = await this.#api_keys.update({
      owner_user_id: gate.user_id,
      api_key_id,
      expected_revision: precondition.revision,
      label: body.label,
      permissions: body.permissions,
      expires_at: body.expires_at,
    });
    if (!result.ok) {
      if ("detail" in result) return validation_failure_response(result);
      return result.reason === "not_found"
        ? not_found_response()
        : stale_revision_response();
    }
    return json_response(200, { ok: true, api_key: present(result.api_key) }, {
      etag: format_api_key_etag(
        result.api_key.api_key_id,
        result.api_key.revision,
      ),
    });
  }

  async revoke(
    request: Request,
    context: ApiKeyHttpRequestContext,
    api_key_id: string,
  ): Promise<Response> {
    const gate = this.#browser_gate(request, context, { mutation: true });
    if (!gate.ok) return gate.response;
    const precondition = decode_precondition(request, api_key_id);
    if (!precondition.ok) return precondition.response;
    const result = await this.#api_keys.revoke(
      gate.user_id,
      api_key_id,
      precondition.revision,
    );
    if (!result.ok) {
      return result.reason === "not_found"
        ? not_found_response()
        : stale_revision_response();
    }
    return json_response(200, { ok: true });
  }

  /**
   * Shared browser-only entry: explicit bearers are rejected outright so a
   * key can never manage keys and an invalid bearer never falls back to the
   * cookie; mutations additionally require the CSRF synchronizer header.
   */
  #browser_gate(
    request: Request,
    context: ApiKeyHttpRequestContext,
    options: { mutation: boolean },
  ): { ok: true; user_id: string } | { ok: false; response: Response } {
    if (request.headers.has("authorization")) {
      return { ok: false, response: bearer_challenge_response() };
    }
    const session = context.session;
    if (session.kind !== "authenticated") {
      return {
        ok: false,
        response: error_response(
          401,
          "not_authenticated",
          "API-key management requires a signed-in creator",
        ),
      };
    }
    if (
      options.mutation &&
      !csrf_tokens_match(
        session.csrf_token,
        request.headers.get("x-csrf-token") ?? "",
      )
    ) {
      return {
        ok: false,
        response: error_response(
          403,
          "invalid_csrf",
          "the request could not be authorized",
        ),
      };
    }
    return { ok: true, user_id: session.user_id };
  }
}

/** Public wire shape; structurally unable to leak the bearer or its hash. */
function present(key: ApiKeyMetadata): {
  api_key_id: string;
  label: string;
  permissions: readonly string[];
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
} {
  return {
    api_key_id: key.api_key_id,
    label: key.label,
    permissions: key.permissions,
    status: key.status,
    expires_at: key.expires_at === null ? null : key.expires_at.toISOString(),
    created_at: key.created_at.toISOString(),
    updated_at: key.updated_at.toISOString(),
    revision: key.revision,
  };
}

type KeyBodyDecodeResult =
  | {
    ok: true;
    label: string;
    permissions: readonly string[];
    expires_at: Date | null;
  }
  | { ok: false; response: Response };

async function decode_key_body(
  request: Request,
  options: { expires_at_required: boolean },
): Promise<KeyBodyDecodeResult> {
  if (!is_json_media_type(request.headers.get("content-type"))) {
    return {
      ok: false,
      response: error_response(
        415,
        "unsupported_media_type",
        "content-type must be application/json",
      ),
    };
  }
  const body_read = await read_bounded_request_text(
    request,
    api_key_request_max_bytes,
  );
  if (!body_read.ok) {
    return {
      ok: false,
      response: body_read.reason === "too_large"
        ? error_response(
          413,
          "request_too_large",
          `request body exceeds ${api_key_request_max_bytes} bytes`,
        )
        : error_response(
          400,
          "invalid_json",
          "request body could not be read",
        ),
    };
  }
  let input: unknown;
  try {
    input = JSON.parse(body_read.text);
  } catch {
    return {
      ok: false,
      response: error_response(
        400,
        "invalid_json",
        "request body is not valid JSON",
      ),
    };
  }
  const shape = strict_object(input, [
    "label",
    "permissions",
    options.expires_at_required ? "expires_at" : "expires_at?",
  ]);
  if (!shape.ok) {
    return {
      ok: false,
      response: error_response(400, "invalid_request", shape.detail),
    };
  }
  const { label, permissions } = shape.value;
  if (typeof label !== "string") {
    return {
      ok: false,
      response: error_response(
        400,
        "invalid_request",
        "label must be a string",
      ),
    };
  }
  if (
    !Array.isArray(permissions) ||
    permissions.some((entry) => typeof entry !== "string")
  ) {
    return {
      ok: false,
      response: error_response(
        400,
        "invalid_request",
        "permissions must be an array of strings",
      ),
    };
  }
  const expires_at = decode_expires_at(shape.value);
  if (!expires_at.ok) {
    return {
      ok: false,
      response: error_response(
        400,
        "invalid_request",
        "expires_at must be an ISO timestamp or null",
      ),
    };
  }
  return {
    ok: true,
    label,
    permissions: permissions as string[],
    expires_at: expires_at.value,
  };
}

function decode_expires_at(
  value: Record<string, unknown>,
): { ok: true; value: Date | null } | { ok: false } {
  if (!Object.hasOwn(value, "expires_at") || value.expires_at === null) {
    return { ok: true, value: null };
  }
  if (typeof value.expires_at !== "string") return { ok: false };
  const parsed = new Date(value.expires_at);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value.expires_at
  ) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

function decode_precondition(
  request: Request,
  api_key_id: string,
):
  | { ok: true; revision: number }
  | { ok: false; response: Response } {
  const raw = request.headers.get("if-match");
  if (raw === null) {
    return {
      ok: false,
      response: error_response(
        428,
        "precondition_required",
        "a strong If-Match validator is required",
      ),
    };
  }
  const parsed = parse_api_key_etag(raw);
  if (parsed === null || parsed.api_key_id !== api_key_id) {
    return {
      ok: false,
      response: error_response(
        412,
        "precondition_failed",
        "the supplied validator does not match this key",
      ),
    };
  }
  return { ok: true, revision: parsed.revision };
}

function validation_failure_response(failure: {
  reason: "invalid_label" | "invalid_permissions" | "invalid_expiry";
  detail: string;
}): Response {
  return error_response(422, failure.reason, failure.detail);
}

function stale_revision_response(): Response {
  return error_response(
    412,
    "precondition_failed",
    "the key changed since the supplied validator",
  );
}

/** Foreign and unknown keys share one non-disclosing shape. */
function not_found_response(): Response {
  return error_response(404, "not_found", "API key not found");
}

/** One non-disclosing challenge for every unusable explicit bearer. */
function bearer_challenge_response(): Response {
  return error_response(
    401,
    "invalid_bearer",
    "the request could not be authenticated",
    { "www-authenticate": 'Bearer realm="api"' },
  );
}

function error_response(
  status: number,
  error: string,
  detail: string,
  extra_headers?: HeadersInit,
): Response {
  return json_response(status, { ok: false, error, detail }, extra_headers);
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
