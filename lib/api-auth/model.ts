/**
 * API principals: the resolved actor behind one `/api/**` request.
 *
 * A browser session and an API key resolve to different principal kinds so
 * policy code — not HTTP adapters or UI — decides CSRF and permission
 * requirements. A key never becomes a synthetic browser session.
 */
import type { ApiKeyPrincipal } from "../api-key/mod.ts";

/** Unauthenticated browser caller; only guest trial publication applies. */
export interface GuestApiPrincipal {
  readonly kind: "guest";
}

/** Signed-in browser caller; mutations require its CSRF synchronizer token. */
export interface BrowserUserApiPrincipal {
  readonly kind: "browser_user";
  readonly user_id: string;
  /** Session synchronizer token compared against the presented token. */
  readonly csrf_token: string;
}

export type ApiPrincipal =
  | GuestApiPrincipal
  | BrowserUserApiPrincipal
  | ApiKeyPrincipal;
