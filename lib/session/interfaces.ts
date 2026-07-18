import type {
  Session,
  SessionCredential,
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

/** Read-only lifecycle surface needed while resolving application requests. */
export interface SessionResolver {
  resolve(credential?: string | null): Promise<SessionResolution>;
}

/** Full lifecycle surface used by request and authentication orchestration. */
export interface SessionManager extends SessionResolver {
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

/**
 * Session persistence is independent from HTTP transport. Implementations must
 * make create, renewal, upgrade/rotation, and revocation atomic.
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
  upgrade(input: SessionUpgrade): Promise<RepositoryUpgradeResult>;
  revoke(
    session_id: string,
    expected_version: number,
    revoked_at: Date,
  ): Promise<boolean>;
}
