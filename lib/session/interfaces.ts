import type {
  Session,
  SessionAuthenticationAttempt,
  SessionAuthenticationAttemptConsumeResult,
  SessionAuthenticationAttemptInput,
  SessionAuthenticationAttemptSaveResult,
  SessionCredential,
  SessionLogoutResult,
  SessionRecord,
  SessionResolution,
  SessionUpgradeResult,
} from "./model.ts";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(): string;
}

export interface CredentialGenerator {
  generate(): string;
}

export interface CsrfTokenGenerator {
  generate(): string;
}

/** Guest view for requests that must not create or renew stored sessions. */
export interface EphemeralGuestSessionSource {
  ephemeral_guest(): Session;
}

/** Read-only lifecycle surface needed while resolving application requests. */
export interface SessionResolver {
  resolve(credential?: string | null): Promise<SessionResolution>;
}

/** Authenticated-session termination surface used by the HTTP boundary. */
export interface SessionLogoutManager {
  logout(session: Session, csrf_token: string): Promise<SessionLogoutResult>;
}

/** Full lifecycle surface used by request and authentication orchestration. */
export interface SessionManager extends SessionResolver, SessionLogoutManager {
  save_authentication_attempt(
    session: Session,
    input: SessionAuthenticationAttemptInput,
  ): Promise<SessionAuthenticationAttemptSaveResult>;
  consume_authentication_attempt(
    session: Session,
    strategy_id: string,
    state: string,
  ): Promise<SessionAuthenticationAttemptConsumeResult>;
  upgrade(session: Session, user_id: string): Promise<SessionUpgradeResult>;
  revoke(session: Session): Promise<boolean>;
}

/** HTTP bearer transport remains independent from session persistence. */
export interface SessionTransport {
  extract(request: Request): string | null;
  attach(response: Response, credential: SessionCredential): Response;
  expire(response: Response): Response;
}

export interface SessionUpgrade {
  readonly session_id: string;
  readonly expected_version: number;
  readonly credential_hash: string;
  readonly csrf_token: string;
  readonly user_id: string;
  readonly authenticated_at: Date;
  readonly absolute_expires_at: Date;
  readonly idle_expires_at: Date;
}

export type RepositoryUpgradeResult =
  | { readonly ok: true; readonly record: SessionRecord }
  | {
    readonly ok: false;
    readonly reason: "stale_session" | "credential_collision";
  };

export interface RepositoryLogout {
  readonly session_id: string;
  readonly expected_version: number;
  readonly csrf_token: string;
  readonly logged_out_at: Date;
}

export type RepositoryLogoutResult =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly reason: "invalid_csrf" | "not_authenticated" | "stale_session";
  };

export interface RepositoryAuthenticationAttemptSave {
  readonly session_id: string;
  readonly expected_version: number;
  readonly attempt: SessionAuthenticationAttempt;
  readonly max_pending_attempts: number;
}

export type RepositoryAuthenticationAttemptSaveResult =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly reason: "stale_session" | "state_collision" | "not_guest";
  };

export interface RepositoryAuthenticationAttemptConsume {
  readonly session_id: string;
  readonly expected_version: number;
  readonly strategy_id: string;
  readonly state_hash: string;
  readonly consumed_at: Date;
}

export type RepositoryAuthenticationAttemptConsumeResult =
  | { readonly ok: true; readonly attempt: SessionAuthenticationAttempt }
  | {
    readonly ok: false;
    readonly reason: "not_found" | "stale_session" | "not_guest";
  };

/**
 * Session persistence is independent from HTTP transport. Implementations must
 * make create, attempt save/consume, renewal, upgrade/rotation, and revocation
 * atomic.
 */
export interface SessionRepository {
  find_by_credential_hash(
    credential_hash: string,
  ): Promise<SessionRecord | null>;
  create(record: SessionRecord): Promise<boolean>;
  renew(
    session_id: string,
    expected_version: number,
    last_seen_at: Date,
    idle_expires_at?: Date,
  ): Promise<SessionRecord | null>;
  save_authentication_attempt(
    input: RepositoryAuthenticationAttemptSave,
  ): Promise<RepositoryAuthenticationAttemptSaveResult>;
  consume_authentication_attempt(
    input: RepositoryAuthenticationAttemptConsume,
  ): Promise<RepositoryAuthenticationAttemptConsumeResult>;
  upgrade(input: SessionUpgrade): Promise<RepositoryUpgradeResult>;
  logout(input: RepositoryLogout): Promise<RepositoryLogoutResult>;
  revoke(
    session_id: string,
    expected_version: number,
    revoked_at: Date,
  ): Promise<boolean>;
}
