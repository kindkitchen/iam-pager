import type { KvRecordGateway } from "../storage/kv-gateway.ts";
import { is_exact_record, is_valid_stored_date } from "../storage/record.ts";
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
import {
  type ApplicationUser,
  type ExternalIdentity,
  type ExternalIdentityObservation,
  type IdentityResolution,
  is_authentication_strategy_id,
} from "./model.ts";

const max_profile_update_attempts = 16;
const user_prefix: Deno.KvKey = ["iam-pager", "identities", "users"];
const provider_identity_prefix: Deno.KvKey = [
  "iam-pager",
  "identities",
  "by-provider",
];

type StoredApplicationUser = ApplicationUser;
type StoredExternalIdentity = ExternalIdentity;

function user_key(user_id: string): Deno.KvKey {
  return [...user_prefix, user_id];
}

function provider_identity_key(
  strategy_id: string,
  provider_subject: string,
): Deno.KvKey {
  return [...provider_identity_prefix, strategy_id, provider_subject];
}

function deserialize_user(value: unknown): ApplicationUser {
  if (!is_exact_record(value, ["user_id", "created_at"])) {
    throw new TypeError("invalid stored identity record");
  }
  const stored = value as unknown as ApplicationUser;
  if (
    typeof stored.user_id !== "string" || stored.user_id === "" ||
    !is_valid_stored_date(stored.created_at)
  ) {
    throw new TypeError("invalid stored identity record");
  }
  return clone_user(stored as ApplicationUser);
}

function deserialize_identity(value: unknown): ExternalIdentity {
  if (
    !is_exact_record(value, [
      "user_id",
      "strategy_id",
      "provider_subject",
      "email",
      "created_at",
      "updated_at",
    ], ["display_name", "picture_url"])
  ) {
    throw new TypeError("invalid stored identity record");
  }
  const stored = value as unknown as ExternalIdentity;
  if (
    typeof stored.user_id !== "string" || stored.user_id === "" ||
    typeof stored.strategy_id !== "string" ||
    !is_authentication_strategy_id(stored.strategy_id) ||
    typeof stored.provider_subject !== "string" ||
    stored.provider_subject === "" ||
    typeof stored.email !== "string" || stored.email === "" ||
    (stored.display_name !== undefined &&
      typeof stored.display_name !== "string") ||
    (stored.picture_url !== undefined &&
      typeof stored.picture_url !== "string") ||
    !is_valid_stored_date(stored.created_at) ||
    !is_valid_stored_date(stored.updated_at) ||
    stored.updated_at < stored.created_at
  ) {
    throw new TypeError("invalid stored identity record");
  }
  return clone_identity(stored as ExternalIdentity);
}

/**
 * Deno KV identity persistence keyed only by strategy and provider subject.
 * User and provider records are created in one atomic commit; profile refreshes
 * use versionstamps so stale observations cannot overwrite newer data.
 */
export class DenoKvIdentityRepository implements IdentityRepository {
  readonly #kv: KvRecordGateway;
  readonly #id_generator: UserIdGenerator;

  constructor(kv: KvRecordGateway, id_generator: UserIdGenerator) {
    this.#kv = kv;
    this.#id_generator = id_generator;
  }

  find_or_create(
    observation: ExternalIdentityObservation,
  ): Promise<IdentityResolution> {
    validate_identity_observation(observation);
    return this.#find_or_create_valid(clone_identity_observation(observation));
  }

  async #find_or_create_valid(
    observation: ExternalIdentityObservation,
  ): Promise<IdentityResolution> {
    const identity_key = provider_identity_key(
      observation.strategy_id,
      observation.provider_subject,
    );
    let identity_entry = await this.#kv.get<StoredExternalIdentity>(
      identity_key,
    );
    if (identity_entry.versionstamp !== null) {
      return await this.#resolve_existing(
        identity_key,
        identity_entry,
        observation,
      );
    }

    for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt++) {
      const user_id = this.#id_generator.generate();
      if (user_id.length === 0) {
        throw new Error("user ID generator must return a non-empty value");
      }
      const generated_user_key = user_key(user_id);
      const user_entry = await this.#kv.get<StoredApplicationUser>(
        generated_user_key,
      );
      if (user_entry.versionstamp !== null) {
        identity_entry = await this.#kv.get<StoredExternalIdentity>(
          identity_key,
        );
        if (identity_entry.versionstamp !== null) {
          return await this.#resolve_existing(
            identity_key,
            identity_entry,
            observation,
          );
        }
        continue;
      }

      const records = create_identity_records(user_id, observation);
      const commit = await this.#kv.native_atomic()
        .check(identity_entry)
        .check(user_entry)
        .set(generated_user_key, clone_user(records.user))
        .set(identity_key, clone_identity(records.identity))
        .commit();
      if (commit.ok) {
        return {
          user: clone_user(records.user),
          identity: clone_identity(records.identity),
          created: true,
        };
      }

      identity_entry = await this.#kv.get<StoredExternalIdentity>(identity_key);
      if (identity_entry.versionstamp !== null) {
        return await this.#resolve_existing(
          identity_key,
          identity_entry,
          observation,
        );
      }
    }
    throw new Error("could not allocate a unique user ID");
  }

  async #resolve_existing(
    identity_key: Deno.KvKey,
    initial_entry: Deno.KvEntryMaybe<StoredExternalIdentity>,
    observation: ExternalIdentityObservation,
  ): Promise<IdentityResolution> {
    let identity_entry = initial_entry;
    for (
      let attempt = 0;
      attempt < max_profile_update_attempts &&
      identity_entry.versionstamp !== null;
      attempt++
    ) {
      const identity = deserialize_identity(identity_entry.value);
      if (
        identity.strategy_id !== observation.strategy_id ||
        identity.provider_subject !== observation.provider_subject
      ) {
        throw new Error("identity repository invariant violated");
      }
      const user_entry = await this.#kv.get<unknown>(
        user_key(identity.user_id),
      );
      if (user_entry.versionstamp === null) {
        throw new Error("identity repository invariant violated");
      }
      const user = deserialize_user(user_entry.value);
      if (user.user_id !== identity.user_id) {
        throw new Error("identity repository invariant violated");
      }

      if (observation.observed_at < identity.updated_at) {
        return {
          user: clone_user(user),
          identity: clone_identity(identity),
          created: false,
        };
      }
      const updated = update_identity(identity, observation);
      const commit = await this.#kv.native_atomic()
        .check(identity_entry)
        .set(identity_key, clone_identity(updated))
        .commit();
      if (commit.ok) {
        return {
          user: clone_user(user),
          identity: clone_identity(updated),
          created: false,
        };
      }
      identity_entry = await this.#kv.get<StoredExternalIdentity>(identity_key);
    }
    if (identity_entry.versionstamp === null) {
      throw new Error("identity repository invariant violated");
    }
    throw new Error("identity profile update remained contended");
  }

  async find_user(user_id: string): Promise<ApplicationUser | null> {
    const entry = await this.#kv.get<unknown>(user_key(user_id));
    if (entry.versionstamp === null) return null;
    const user = deserialize_user(entry.value);
    if (user.user_id !== user_id) {
      throw new Error("identity repository invariant violated");
    }
    return user;
  }

  async find_by_strategy_subject(
    strategy_id: string,
    provider_subject: string,
  ): Promise<ExternalIdentity | null> {
    const entry = await this.#kv.get<unknown>(
      provider_identity_key(strategy_id, provider_subject),
    );
    if (entry.versionstamp === null) return null;
    const identity = deserialize_identity(entry.value);
    if (
      identity.strategy_id !== strategy_id ||
      identity.provider_subject !== provider_subject
    ) {
      throw new Error("identity repository invariant violated");
    }
    return identity;
  }
}
