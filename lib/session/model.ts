/** Server-owned session state exposed to application request handlers. */
interface BaseSession {
  readonly session_id: string;
  readonly session_version: number;
  readonly created_at: Date;
  readonly last_seen_at: Date;
  readonly absolute_expires_at: Date;
}

export interface GuestSession extends BaseSession {
  readonly kind: "guest";
}

export interface AuthenticatedSession extends BaseSession {
  readonly kind: "authenticated";
  readonly user_id: string;
  readonly authenticated_at: Date;
  readonly idle_expires_at: Date;
  /** Synchronizer token exposed only to trusted application UI. */
  readonly csrf_token: string;
}

export type Session = GuestSession | AuthenticatedSession;

/** Server-side, one-use authentication state owned by a guest session. */
export interface SessionAuthenticationAttempt {
  readonly strategy_id: string;
  readonly state_hash: string;
  readonly callback_url: string;
  readonly return_to: string;
  readonly attempt_context?: string;
  readonly created_at: Date;
  readonly expires_at: Date;
}

/** Raw state exists only at the service boundary and is never persisted. */
export interface SessionAuthenticationAttemptInput {
  readonly strategy_id: string;
  readonly state: string;
  readonly callback_url: string;
  readonly return_to: string;
  readonly attempt_context?: string;
}

export type SessionAuthenticationAttemptSaveResult =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly reason: "stale_session" | "state_collision" | "not_guest";
  };

export type SessionAuthenticationAttemptConsumeResult =
  | { readonly ok: true; readonly attempt: SessionAuthenticationAttempt }
  | {
    readonly ok: false;
    readonly reason: "invalid_attempt" | "stale_session" | "not_guest";
  };

/** Persistence shape. Browser credentials and raw OAuth state are absent. */
export type SessionRecord = Session & {
  readonly credential_hash: string;
  readonly revoked_at: Date | null;
  readonly authentication_attempts: readonly SessionAuthenticationAttempt[];
};

/** A credential that the HTTP transport must attach to the response. */
export interface SessionCredential {
  readonly value: string;
  readonly expires_at: Date;
}

export interface SessionResolution {
  readonly session: Session;
  /** Present for a new session, credential rotation, or bounded renewal. */
  readonly credential_to_set?: SessionCredential;
}

export type SessionUpgradeResult =
  | { readonly ok: true; readonly resolution: SessionResolution }
  | { readonly ok: false; readonly reason: "stale_session" };

export type SessionLogoutResult =
  | { readonly ok: true; readonly resolution: SessionResolution }
  | {
    readonly ok: false;
    readonly reason: "invalid_csrf" | "not_authenticated" | "stale_session";
  };

export function session_expiry(session: Session): Date {
  if (session.kind === "guest") return session.absolute_expires_at;
  return session.idle_expires_at < session.absolute_expires_at
    ? session.idle_expires_at
    : session.absolute_expires_at;
}
