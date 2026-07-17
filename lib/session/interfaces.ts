import type { SessionRecord } from "./model.ts";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(): string;
}

export interface CredentialGenerator {
  generate(): string;
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
