import { csrf_tokens_match } from "../http/csrf.ts";
import { read_bounded_request_bytes } from "../http/request-body.ts";
import type { AppRequestContext } from "../request-context.ts";
import type { StorageConnectionManagement } from "./connection-management.ts";
import { is_external_provider_id } from "./model.ts";

export interface StorageConnectionManagementHttpHandler {
  list(request: Request, context: AppRequestContext): Promise<Response>;
  connect(
    request: Request,
    context: AppRequestContext,
    provider_id: string,
  ): Promise<Response>;
  disconnect(
    request: Request,
    context: AppRequestContext,
    provider_id: string,
  ): Promise<Response>;
}

/** Browser-owned JSON/redirect boundary; credentials can never enter its model. */
export class StorageConnectionManagementHttpAdapter
  implements StorageConnectionManagementHttpHandler {
  readonly #management: StorageConnectionManagement;

  constructor(management: StorageConnectionManagement) {
    this.#management = management;
  }

  async list(request: Request, context: AppRequestContext): Promise<Response> {
    const gate = browser_gate(request, context, false);
    if (!gate.ok) return gate.response;
    const connections = await this.#management.list_owned(gate.user_id);
    return json_response(200, {
      ok: true,
      connections: connections.map((connection) => ({
        connection_id: connection.connection_id,
        provider_id: connection.provider_id,
        provider_label: connection.provider_label,
        provider_subject: connection.provider_subject,
        scopes: connection.scopes,
        status: connection.status,
        capabilities: connection.capabilities,
        created_at: connection.created_at.toISOString(),
        updated_at: connection.updated_at.toISOString(),
      })),
    });
  }

  async connect(
    request: Request,
    context: AppRequestContext,
    provider_id: string,
  ): Promise<Response> {
    const gate = browser_gate(request, context, true);
    if (!gate.ok) return gate.response;
    const body = await read_bounded_request_bytes(request, 0);
    if (!body.ok) {
      return error_response(
        400,
        "invalid_request",
        "connect takes no request body",
      );
    }
    const connect_path = is_external_provider_id(provider_id)
      ? this.#management.connect_path(provider_id)
      : null;
    if (connect_path === null) return not_found_response();
    return new Response(null, {
      status: 303,
      headers: { "cache-control": "no-store", location: connect_path },
    });
  }

  async disconnect(
    request: Request,
    context: AppRequestContext,
    provider_id: string,
  ): Promise<Response> {
    const gate = browser_gate(request, context, true);
    if (!gate.ok) return gate.response;
    const body = await read_bounded_request_bytes(request, 0);
    if (!body.ok) {
      return error_response(
        400,
        "invalid_request",
        "disconnect takes no request body",
      );
    }
    if (!is_external_provider_id(provider_id)) return not_found_response();
    const result = await this.#management.disconnect(
      context.session,
      provider_id,
    );
    if (!result.ok) {
      return result.reason === "invalid_attempt" ||
          result.reason === "provider_not_supported"
        ? not_found_response()
        : error_response(409, "disconnect_failed", "storage disconnect failed");
    }
    return json_response(200, { ok: true });
  }
}

function browser_gate(
  request: Request,
  context: AppRequestContext,
  mutation: boolean,
): { ok: true; user_id: string } | { ok: false; response: Response } {
  if (request.headers.has("authorization")) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          ok: false,
          error: "invalid_bearer",
          detail: "browser authentication required",
        }) + "\n",
        {
          status: 401,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "www-authenticate": 'Bearer realm="iam-pager"',
          },
        },
      ),
    };
  }
  if (context.session.kind !== "authenticated") {
    return {
      ok: false,
      response: error_response(
        401,
        "not_authenticated",
        "storage management requires a signed-in creator",
      ),
    };
  }
  if (
    mutation &&
    !csrf_tokens_match(
      context.session.csrf_token,
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
  return { ok: true, user_id: context.session.user_id };
}

function not_found_response(): Response {
  return error_response(404, "not_found", "storage provider was not found");
}

function error_response(
  status: number,
  code: string,
  message: string,
): Response {
  return json_response(status, { ok: false, error: code, detail: message });
}

function json_response(status: number, body: unknown): Response {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
