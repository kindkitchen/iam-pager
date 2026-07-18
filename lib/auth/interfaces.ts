import type {
  ApplicationUser,
  AuthenticationBeginInput,
  AuthenticationBeginOutput,
  AuthenticationCompleteInput,
  AuthenticationIdentity,
  AuthenticationStrategyResult,
  ExternalIdentity,
  ExternalIdentityObservation,
  IdentityResolution,
} from "./model.ts";

/** User ID source used by the first identity repository implementation. */
export interface UserIdGenerator {
  generate(): string;
}

/**
 * Identity persistence keyed exclusively by (strategy_id, provider_subject).
 * Implementations must atomically find-or-create the local user/identity pair
 * and may update only the existing identity's non-authoritative profile fields.
 */
export interface IdentityRepository {
  find_or_create(
    observation: ExternalIdentityObservation,
  ): Promise<IdentityResolution>;
  find_user(user_id: string): Promise<ApplicationUser | null>;
  find_by_strategy_subject(
    strategy_id: string,
    provider_subject: string,
  ): Promise<ExternalIdentity | null>;
}

/** A provider adapter. Routes and orchestration depend only on this contract. */
export interface AuthenticationStrategy {
  readonly strategy_id: string;
  begin(
    input: AuthenticationBeginInput,
  ): Promise<AuthenticationStrategyResult<AuthenticationBeginOutput>>;
  complete(
    input: AuthenticationCompleteInput,
  ): Promise<AuthenticationStrategyResult<AuthenticationIdentity>>;
}

/** Read-only strategy selection surface used by authentication orchestration. */
export interface AuthenticationStrategyResolver {
  resolve(strategy_id: string): AuthenticationStrategy | null;
}
