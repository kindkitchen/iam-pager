import type { IdentityRepository, UserIdGenerator } from "./interfaces.ts";
import {
  clone_identity,
  clone_identity_observation,
  clone_user,
  create_identity_records,
  MAX_ID_GENERATION_ATTEMPTS,
  update_identity,
  validate_identity_observation,
} from "./identity-repository-common.ts";
import type {
  ApplicationUser,
  ExternalIdentity,
  ExternalIdentityObservation,
  IdentityResolution,
} from "./model.ts";

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
    validate_identity_observation(observation);
    const observed_identity = clone_identity_observation(observation);
    const key = identity_key(
      observed_identity.strategy_id,
      observed_identity.provider_subject,
    );
    const existing = this.#identities.get(key);
    if (existing !== undefined) {
      const user = this.#users.get(existing.user_id);
      if (user === undefined) {
        throw new Error("identity repository invariant violated");
      }
      const identity = observed_identity.observed_at < existing.updated_at
        ? existing
        : update_identity(existing, observed_identity);
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

      const records = create_identity_records(user_id, observed_identity);
      this.#users.set(user_id, records.user);
      this.#identities.set(key, records.identity);
      return Promise.resolve({
        user: clone_user(records.user),
        identity: clone_identity(records.identity),
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
}

function identity_key(strategy_id: string, provider_subject: string): string {
  return JSON.stringify([strategy_id, provider_subject]);
}
