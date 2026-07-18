import type { Session, SessionResolution } from "../session/model.ts";

/** A local account. Provider-specific profile data stays on its identity. */
export interface ApplicationUser {
  readonly user_id: string;
  readonly created_at: Date;
}

/**
 * A provider identity linked by stable strategy and provider subject, never by
 * mutable profile fields such as email.
 */
export interface ExternalIdentity {
  readonly user_id: string;
  readonly strategy_id: string;
  readonly provider_subject: string;
  readonly email: string;
  readonly display_name?: string;
  readonly picture_url?: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** Latest verified provider profile presented to identity persistence. */
export interface ExternalIdentityObservation {
  readonly strategy_id: string;
  readonly provider_subject: string;
  readonly email: string;
  readonly display_name?: string;
  readonly picture_url?: string;
  readonly observed_at: Date;
}

export interface IdentityResolution {
  readonly user: ApplicationUser;
  readonly identity: ExternalIdentity;
  /** True only when both the local user and identity were created. */
  readonly created: boolean;
}

/** Provider-neutral input for beginning an authentication redirect. */
export interface AuthenticationBeginInput {
  readonly state: string;
  readonly callback_url: string;
}

export interface AuthenticationBeginOutput {
  readonly authorization_url: string;
  /** Opaque strategy data kept server-side with the bounded attempt. */
  readonly attempt_context?: string;
}

/** Provider-neutral input for completing a redirect callback. */
export interface AuthenticationCompleteInput {
  readonly code: string;
  readonly callback_url: string;
  readonly attempt_context?: string;
}

/** Verified provider output; the selected strategy supplies strategy_id. */
export interface AuthenticationIdentity {
  readonly provider_subject: string;
  readonly email: string;
  readonly display_name?: string;
  readonly picture_url?: string;
}

export type AuthenticationStrategyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: "provider_failure" };

export interface AuthenticationStartRequest {
  readonly session: Session;
  readonly strategy_id: string;
  readonly callback_url: string;
  readonly return_to?: string;
}

export interface AuthenticationStartOutput {
  readonly authorization_url: string;
}

export type AuthenticationStartResult =
  | { readonly ok: true; readonly value: AuthenticationStartOutput }
  | {
    readonly ok: false;
    readonly reason:
      | "unknown_strategy"
      | "not_guest"
      | "invalid_return_to"
      | "invalid_callback_url"
      | "provider_failure"
      | "stale_session";
  };

export interface AuthenticationCallbackRequest {
  readonly session: Session;
  readonly strategy_id: string;
  readonly code: string;
  readonly state: string;
}

export interface AuthenticationCallbackOutput {
  readonly identity: IdentityResolution;
  readonly session_resolution: SessionResolution;
  readonly return_to: string;
}

export type AuthenticationCallbackResult =
  | { readonly ok: true; readonly value: AuthenticationCallbackOutput }
  | {
    readonly ok: false;
    readonly reason:
      | "unknown_strategy"
      | "not_guest"
      | "invalid_attempt"
      | "invalid_callback"
      | "provider_failure"
      | "stale_session";
  };

const STRATEGY_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_RETURN_TO_LENGTH = 2048;

export function is_authentication_strategy_id(value: string): boolean {
  return STRATEGY_ID_PATTERN.test(value);
}

/** Validate every decoded form before using a caller-supplied local return. */
export function normalize_authentication_return_to(
  value?: string,
): string | null {
  if (value === undefined || value.length === 0) return "/";
  if (value.length > MAX_RETURN_TO_LENGTH) return null;

  let candidate = value;
  for (let pass = 0; pass < 8; pass++) {
    if (
      !candidate.startsWith("/") || candidate.startsWith("//") ||
      candidate.includes("\\") || contains_control_character(candidate)
    ) {
      return null;
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      return null;
    }
    if (decoded === candidate) return value;
    candidate = decoded;
  }
  return null;
}

function contains_control_character(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
