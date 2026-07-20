import { ownership_database_schema_version } from "../storage/schema-versions.ts";
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

const storage_schema_version = ownership_database_schema_version;
const max_profile_update_attempts = 16;
// Key paths stay stable across value-schema upgrades so uniqueness cannot fork.
const user_prefix: Deno.KvKey = ["iam-pager", "identities", "users"];
const provider_identity_prefix: Deno.KvKey = [
  "iam-pager",
  "identities",
  "by-provider",
];

interface StoredApplicationUser {
  readonly schema_version: 1;
  readonly user_id: string;
  readonly created_at: string;
}

interface StoredExternalIdentity {
  readonly schema_version: 1;
  readonly user_id: string;
  readonly strategy_id: string;
  readonly provider_subject: string;
  readonly email: string;
  readonly display_name?: string;
  readonly picture_url?: string;
  readonly created_at: string;
  readonly updated_at: string;
}

function user_key(user_id: string): Deno.KvKey {
  return [...user_prefix, user_id];
}

function provider_identity_key(
  strategy_id: string,
  provider_subject: string,
): Deno.KvKey {
  return [...provider_identity_prefix, strategy_id, provider_subject];
}

function serialize_user(user: ApplicationUser): StoredApplicationUser {
  return {
    schema_version: storage_schema_version,
    user_id: user.user_id,
    created_at: user.created_at.toISOString(),
  };
}

function serialize_identity(
  identity: ExternalIdentity,
): StoredExternalIdentity {
  return {
    schema_version: storage_schema_version,
    user_id: identity.user_id,
    strategy_id: identity.strategy_id,
    provider_subject: identity.provider_subject,
    email: identity.email,
    ...(identity.display_name === undefined
      ? {}
      : { display_name: identity.display_name }),
    ...(identity.picture_url === undefined
      ? {}
      : { picture_url: identity.picture_url }),
    created_at: identity.created_at.toISOString(),
    updated_at: identity.updated_at.toISOString(),
  };
}

function stored_date(value: unknown): Date {
  if (typeof value !== "string") {
    throw new TypeError("invalid stored identity record");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new TypeError("invalid stored identity record");
  }
  return date;
}

function deserialize_user(value: unknown): ApplicationUser {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("invalid stored identity record");
  }
  const stored = value as Record<string, unknown>;
  if (
    stored.schema_version !== storage_schema_version ||
    typeof stored.user_id !== "string" || stored.user_id.length === 0
  ) {
    throw new TypeError("invalid stored identity record");
  }
  return {
    user_id: stored.user_id,
    created_at: stored_date(stored.created_at),
  };
}

function deserialize_identity(value: unknown): ExternalIdentity {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("invalid stored identity record");
  }
  const stored = value as Record<string, unknown>;
  if (
    stored.schema_version !== storage_schema_version ||
    typeof stored.user_id !== "string" || stored.user_id.length === 0 ||
    typeof stored.strategy_id !== "string" ||
    !is_authentication_strategy_id(stored.strategy_id) ||
    typeof stored.provider_subject !== "string" ||
    stored.provider_subject.length === 0 ||
    typeof stored.email !== "string" || stored.email.length === 0 ||
    (stored.display_name !== undefined &&
      typeof stored.display_name !== "string") ||
    (stored.picture_url !== undefined && typeof stored.picture_url !== "string")
  ) {
    throw new TypeError("invalid stored identity record");
  }
  const created_at = stored_date(stored.created_at);
  const updated_at = stored_date(stored.updated_at);
  if (updated_at < created_at) {
    throw new TypeError("invalid stored identity record");
  }
  return {
    user_id: stored.user_id,
    strategy_id: stored.strategy_id,
    provider_subject: stored.provider_subject,
    email: stored.email,
    display_name: stored.display_name as string | undefined,
    picture_url: stored.picture_url as string | undefined,
    created_at,
    updated_at,
  };
}

/**
 * Deno KV identity persistence keyed only by strategy and provider subject.
 * User and provider records are created in one atomic commit; profile refreshes
 * use versionstamps so stale observations cannot overwrite newer data.
 */
export class DenoKvIdentityRepository implements IdentityRepository {
  readonly #kv: Deno.Kv;
  readonly #id_generator: UserIdGenerator;

  constructor(kv: Deno.Kv, id_generator: UserIdGenerator) {
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
      const commit = await this.#kv.atomic()
        .check(identity_entry)
        .check(user_entry)
        .set(generated_user_key, serialize_user(records.user))
        .set(identity_key, serialize_identity(records.identity))
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
      const commit = await this.#kv.atomic()
        .check(identity_entry)
        .set(identity_key, serialize_identity(updated))
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
