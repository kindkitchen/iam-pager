import type { ApiKeyBearerResolver } from "../api-key/mod.ts";
import type { Session } from "../session/mod.ts";
import type { ApiPrincipal } from "./model.ts";

export type ApiAuthenticationResult =
  | { readonly ok: true; readonly principal: ApiPrincipal }
  | { readonly ok: false; readonly reason: "invalid_bearer" };

/**
 * Resolves the actor behind one API request.
 *
 * An `Authorization` header, when present, is authoritative: a malformed,
 * unknown, expired, or revoked bearer fails the request outright and the
 * session cookie never becomes a fallback. Without the header the browser
 * session decides between a guest and a signed-in user.
 */
export interface ApiRequestAuthenticator {
  authenticate(
    request: Request,
    session: Session,
  ): Promise<ApiAuthenticationResult>;
}

/** Exactly one `Bearer` product with one token; anything else is malformed. */
const bearer_scheme_pattern = /^Bearer (\S+)$/;

export interface BearerFirstApiRequestAuthenticatorOptions {
  /** Absent means fail closed: every explicit bearer is rejected. */
  readonly bearer_resolver?: ApiKeyBearerResolver;
}

/** Default authenticator: bearer first, session fallback only without one. */
export class BearerFirstApiRequestAuthenticator
  implements ApiRequestAuthenticator {
  readonly #bearer_resolver: ApiKeyBearerResolver;

  constructor(options: BearerFirstApiRequestAuthenticatorOptions = {}) {
    this.#bearer_resolver = options.bearer_resolver ??
      { resolve_bearer: () => Promise.resolve(null) };
  }

  async authenticate(
    request: Request,
    session: Session,
  ): Promise<ApiAuthenticationResult> {
    const authorization = request.headers.get("authorization");
    if (authorization !== null) {
      const match = bearer_scheme_pattern.exec(authorization);
      if (match === null) return { ok: false, reason: "invalid_bearer" };
      const principal = await this.#bearer_resolver.resolve_bearer(match[1]);
      if (principal === null) return { ok: false, reason: "invalid_bearer" };
      return { ok: true, principal };
    }
    if (session.kind === "authenticated") {
      return {
        ok: true,
        principal: {
          kind: "browser_user",
          user_id: session.user_id,
          csrf_token: session.csrf_token,
        },
      };
    }
    return { ok: true, principal: { kind: "guest" } };
  }
}
