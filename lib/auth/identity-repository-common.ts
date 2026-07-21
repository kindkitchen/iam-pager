import type {
  ApplicationUser,
  ExternalIdentity,
  ExternalIdentityObservation,
} from "./model.ts";
import { is_authentication_strategy_id } from "./model.ts";

export const MAX_ID_GENERATION_ATTEMPTS = 8;

export interface IdentityRecords {
  readonly user: ApplicationUser;
  readonly identity: ExternalIdentity;
}

export function validate_identity_observation(
  observation: ExternalIdentityObservation,
): void {
  if (!is_authentication_strategy_id(observation.strategy_id)) {
    throw new TypeError("strategy_id must be a lowercase route-safe ID");
  }
  if (observation.provider_subject.length === 0) {
    throw new TypeError("provider_subject must not be empty");
  }
  if (observation.email.length === 0) {
    throw new TypeError("email must not be empty");
  }
  if (Number.isNaN(observation.observed_at.getTime())) {
    throw new TypeError("observed_at must be a valid date");
  }
}

export function clone_identity_observation(
  observation: ExternalIdentityObservation,
): ExternalIdentityObservation {
  return structuredClone(observation);
}

export function create_identity_records(
  user_id: string,
  observation: ExternalIdentityObservation,
): IdentityRecords {
  const user: ApplicationUser = {
    user_id,
    created_at: new Date(observation.observed_at),
  };
  const identity: ExternalIdentity = {
    user_id,
    strategy_id: observation.strategy_id,
    provider_subject: observation.provider_subject,
    email: observation.email,
    display_name: observation.display_name,
    picture_url: observation.picture_url,
    created_at: new Date(observation.observed_at),
    updated_at: new Date(observation.observed_at),
  };
  return { user, identity };
}

export function update_identity(
  existing: ExternalIdentity,
  observation: ExternalIdentityObservation,
): ExternalIdentity {
  return {
    ...existing,
    email: observation.email,
    display_name: observation.display_name,
    picture_url: observation.picture_url,
    updated_at: new Date(observation.observed_at),
  };
}

export function clone_user(user: ApplicationUser): ApplicationUser {
  return structuredClone(user);
}

export function clone_identity(identity: ExternalIdentity): ExternalIdentity {
  return structuredClone(identity);
}
