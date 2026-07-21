import type { ApiKeyPermission } from "../api-key/mod.ts";
import { csrf_tokens_match } from "../http/csrf.ts";
import type { ApiPrincipal } from "./model.ts";

/** One authorization question: which grant does this operation need. */
export interface ApiOperationRequest {
  readonly permission: ApiKeyPermission;
  /** Token presented by the browser client; ignored for key principals. */
  readonly presented_csrf_token?: string | null;
}

export type ApiAuthorizationFailure =
  | "not_authenticated"
  | "invalid_csrf"
  | "insufficient_permission";

export type ApiAuthorizationResult =
  | { readonly ok: true; readonly user_id: string }
  | { readonly ok: false; readonly reason: ApiAuthorizationFailure };

/**
 * Maps a principal onto one operation. Adapters translate the typed failure
 * into wire responses; they never re-derive authority themselves.
 */
export interface ApiOperationPolicy {
  authorize(
    principal: ApiPrincipal,
    operation: ApiOperationRequest,
  ): ApiAuthorizationResult;
}

/**
 * The documented matrix: guests are unauthenticated; browser users hold every
 * permission but need their CSRF synchronizer token on non-`read` operations;
 * key principals need the mapped explicit permission and never CSRF.
 */
export class PermissionApiOperationPolicy implements ApiOperationPolicy {
  authorize(
    principal: ApiPrincipal,
    operation: ApiOperationRequest,
  ): ApiAuthorizationResult {
    if (principal.kind === "guest") {
      return { ok: false, reason: "not_authenticated" };
    }
    if (principal.kind === "browser_user") {
      if (
        operation.permission !== "read" &&
        !csrf_tokens_match(
          principal.csrf_token,
          operation.presented_csrf_token ?? "",
        )
      ) {
        return { ok: false, reason: "invalid_csrf" };
      }
      return { ok: true, user_id: principal.user_id };
    }
    if (!principal.permissions.includes(operation.permission)) {
      return { ok: false, reason: "insufficient_permission" };
    }
    return { ok: true, user_id: principal.user_id };
  }
}
