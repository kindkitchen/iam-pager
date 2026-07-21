import { hash_api_key_bearer } from "./generators.ts";
import type {
  ApiKeyBearerResolver,
  ApiKeyManager,
  ApiKeyRepository,
  Clock,
  CreateApiKeyRequest,
  CreateApiKeyResult,
  IdGenerator,
  RevokeAllApiKeysResult,
  RevokeApiKeyResult,
  SecretGenerator,
  UpdateApiKeyRequest,
  UpdateApiKeyResult,
} from "./interfaces.ts";
import {
  api_key_authenticates,
  api_key_bearer_prefix,
  api_key_metadata,
  type ApiKeyMetadata,
  type ApiKeyPermission,
  type ApiKeyPrincipal,
  type ApiKeyRecord,
  is_valid_api_key_id,
  is_valid_api_key_label,
  is_well_formed_bearer,
  normalize_api_key_permissions,
  sort_api_key_metadata,
} from "./model.ts";

export interface ApiKeyServiceOptions {
  readonly repository: ApiKeyRepository;
  readonly clock: Clock;
  readonly id_generator: IdGenerator;
  readonly secret_generator: SecretGenerator;
}

const max_create_attempts = 3;

type ValidatedInput =
  | {
    readonly ok: true;
    readonly label: string;
    readonly permissions: readonly ApiKeyPermission[];
    readonly expires_at: Date | null;
  }
  | {
    readonly ok: false;
    readonly reason: "invalid_label" | "invalid_permissions" | "invalid_expiry";
    readonly detail: string;
  };

/**
 * Transport-independent API-key lifecycle. The raw bearer exists only inside
 * `create` (returned once) and `resolve_bearer` (hashed immediately); every
 * other path works with hashes and bounded metadata.
 */
export class ApiKeyService implements ApiKeyManager, ApiKeyBearerResolver {
  readonly #repository: ApiKeyRepository;
  readonly #clock: Clock;
  readonly #id_generator: IdGenerator;
  readonly #secret_generator: SecretGenerator;

  constructor(options: ApiKeyServiceOptions) {
    this.#repository = options.repository;
    this.#clock = options.clock;
    this.#id_generator = options.id_generator;
    this.#secret_generator = options.secret_generator;
  }

  async create(request: CreateApiKeyRequest): Promise<CreateApiKeyResult> {
    const now = this.#clock.now();
    const validated = this.#validate(request, now);
    if (!validated.ok) return validated;

    for (let attempt = 0; attempt < max_create_attempts; attempt++) {
      const api_key_id = this.#id_generator.generate();
      if (!is_valid_api_key_id(api_key_id)) {
        throw new Error("ID generator produced an invalid API-key ID");
      }
      const bearer =
        `${api_key_bearer_prefix}${this.#secret_generator.generate()}`;
      if (!is_well_formed_bearer(bearer)) {
        throw new Error("secret generator produced a malformed bearer");
      }
      const record: ApiKeyRecord = {
        api_key_id,
        owner_user_id: request.owner_user_id,
        label: validated.label,
        permissions: validated.permissions,
        secret_hash: await hash_api_key_bearer(bearer),
        created_at: now,
        updated_at: now,
        expires_at: validated.expires_at,
        revision: 1,
      };
      if (await this.#repository.create(record)) {
        return { ok: true, api_key: api_key_metadata(record, now), bearer };
      }
    }
    throw new Error("could not allocate a unique API key");
  }

  async list_owned(owner_user_id: string): Promise<ApiKeyMetadata[]> {
    const now = this.#clock.now();
    const records = await this.#repository.list_by_owner(owner_user_id);
    return sort_api_key_metadata(
      records.map((record) => api_key_metadata(record, now)),
    );
  }

  async inspect(
    owner_user_id: string,
    api_key_id: string,
  ): Promise<ApiKeyMetadata | null> {
    const record = await this.#repository.find_by_id(api_key_id);
    if (record === null || record.owner_user_id !== owner_user_id) return null;
    return api_key_metadata(record, this.#clock.now());
  }

  async update(request: UpdateApiKeyRequest): Promise<UpdateApiKeyResult> {
    const now = this.#clock.now();
    const validated = this.#validate(request, now);
    if (!validated.ok) return validated;
    const result = await this.#repository.update({
      api_key_id: request.api_key_id,
      owner_user_id: request.owner_user_id,
      expected_revision: request.expected_revision,
      label: validated.label,
      permissions: validated.permissions,
      expires_at: validated.expires_at,
      updated_at: now,
    });
    if (!result.ok) return result;
    return { ok: true, api_key: api_key_metadata(result.record, now) };
  }

  revoke(
    owner_user_id: string,
    api_key_id: string,
    expected_revision: number,
  ): Promise<RevokeApiKeyResult> {
    return this.#repository.revoke(
      api_key_id,
      owner_user_id,
      expected_revision,
    );
  }

  async revoke_all(owner_user_id: string): Promise<RevokeAllApiKeysResult> {
    const revoked_count = await this.#repository.revoke_all_by_owner(
      owner_user_id,
    );
    return { ok: true, revoked_count };
  }

  async resolve_bearer(bearer: string): Promise<ApiKeyPrincipal | null> {
    if (!is_well_formed_bearer(bearer)) return null;
    const record = await this.#repository.find_by_secret_hash(
      await hash_api_key_bearer(bearer),
    );
    if (record === null) return null;
    if (!api_key_authenticates(record, this.#clock.now())) return null;
    return {
      kind: "api_key",
      api_key_id: record.api_key_id,
      user_id: record.owner_user_id,
      permissions: record.permissions,
    };
  }

  #validate(
    input: Pick<CreateApiKeyRequest, "label" | "permissions" | "expires_at">,
    now: Date,
  ): ValidatedInput {
    if (!is_valid_api_key_label(input.label)) {
      return {
        ok: false,
        reason: "invalid_label",
        detail: "label must be 1-64 characters without control characters",
      };
    }
    const permissions = normalize_api_key_permissions(input.permissions);
    if (!permissions.ok) {
      return {
        ok: false,
        reason: "invalid_permissions",
        detail: permissions.detail,
      };
    }
    if (input.expires_at !== null) {
      if (Number.isNaN(input.expires_at.getTime())) {
        return {
          ok: false,
          reason: "invalid_expiry",
          detail: "expires_at must be a valid timestamp or null",
        };
      }
      if (input.expires_at <= now) {
        return {
          ok: false,
          reason: "invalid_expiry",
          detail: "expires_at must be in the future",
        };
      }
    }
    return {
      ok: true,
      label: input.label,
      permissions: permissions.permissions,
      expires_at: input.expires_at,
    };
  }
}
