import type { IdentityRepository, UserIdGenerator } from "./interfaces.ts";
import {
  type ApplicationUser,
  type ExternalIdentity,
  type ExternalIdentityObservation,
  type IdentityResolution,
  is_authentication_strategy_id,
} from "./model.ts";

const MAX_ID_GENERATION_ATTEMPTS = 8;

/** Process-local identity storage. A restart loses every user and identity. */
export class MemoryIdentityRepository implements IdentityRepository {
  readonly #id_generator: UserIdGenerator;
  #users = new Map<string, ApplicationUser>();
  #identities = new Map<string, ExternalIdentity>();

  constructor(id_generator: UserIdGenerator) {
    this.#id_generator = id_generator;
  }

  find_or_create(
    observation: ExternalIdentityObservation,
  ): Promise<IdentityResolution> {
    validate_observation(observation);
    const key = identity_key(
      observation.strategy_id,
      observation.provider_subject,
    );
    const existing = this.#identities.get(key);
    if (existing !== undefined) {
      const user = this.#users.get(existing.user_id);
      if (user === undefined) {
        throw new Error("identity repository invariant violated");
      }
      const identity = observation.observed_at < existing.updated_at
        ? existing
        : updated_identity(existing, observation);
      this.#identities.set(key, identity);
      return Promise.resolve({
        user: clone_user(user),
        identity: clone_identity(identity),
        created: false,
      });
    }

    for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt++) {
      const user_id = this.#id_generator.generate();
      if (user_id.length === 0) {
        throw new Error("user ID generator must return a non-empty value");
      }
      if (this.#users.has(user_id)) continue;

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
      this.#users.set(user_id, user);
      this.#identities.set(key, identity);
      return Promise.resolve({
        user: clone_user(user),
        identity: clone_identity(identity),
        created: true,
      });
    }
    throw new Error("could not allocate a unique user ID");
  }

  find_user(user_id: string): Promise<ApplicationUser | null> {
    const user = this.#users.get(user_id);
    return Promise.resolve(user === undefined ? null : clone_user(user));
  }

  find_by_strategy_subject(
    strategy_id: string,
    provider_subject: string,
  ): Promise<ExternalIdentity | null> {
    const identity = this.#identities.get(
      identity_key(strategy_id, provider_subject),
    );
    return Promise.resolve(
      identity === undefined ? null : clone_identity(identity),
    );
  }

  get user_count(): number {
    return this.#users.size;
  }

  get identity_count(): number {
    return this.#identities.size;
  }
}

function identity_key(strategy_id: string, provider_subject: string): string {
  return JSON.stringify([strategy_id, provider_subject]);
}

function updated_identity(
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

function validate_observation(
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

function clone_user(user: ApplicationUser): ApplicationUser {
  return { user_id: user.user_id, created_at: new Date(user.created_at) };
}

function clone_identity(identity: ExternalIdentity): ExternalIdentity {
  return {
    user_id: identity.user_id,
    strategy_id: identity.strategy_id,
    provider_subject: identity.provider_subject,
    email: identity.email,
    display_name: identity.display_name,
    picture_url: identity.picture_url,
    created_at: new Date(identity.created_at),
    updated_at: new Date(identity.updated_at),
  };
}
