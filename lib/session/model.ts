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
}

export type Session = GuestSession | AuthenticatedSession;

/** Persistence shape. The bearer credential itself is deliberately absent. */
export type SessionRecord = Session & {
  readonly credential_hash: string;
  readonly revoked_at: Date | null;
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

export function session_expiry(session: Session): Date {
  if (session.kind === "guest") return session.absolute_expires_at;
  return session.idle_expires_at < session.absolute_expires_at
    ? session.idle_expires_at
    : session.absolute_expires_at;
}
