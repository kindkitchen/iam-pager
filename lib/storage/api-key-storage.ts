import type { ApiKeyRepository } from "../api-key/interfaces.ts";
import { DenoKvApiKeyRepository } from "../api-key/kv-repository.ts";
import { MemoryApiKeyRepository } from "../api-key/memory-repository.ts";
import {
  DenoKvDatabaseOpener,
  type KvDatabaseOpener,
  type OwnershipStorageConfig,
  parse_dependent_storage_config,
  type StorageConfig,
  type StorageEnvironmentSource,
} from "./ownership-storage.ts";

export const API_KEY_STORAGE_BACKEND_ENV = "IAM_PAGER_API_KEY_STORAGE_BACKEND";

export type ApiKeyStorageEnvironmentSource = StorageEnvironmentSource;
export type ApiKeyStorageConfig = StorageConfig;

export interface ApiKeyRepositoryFactory {
  create(config: ApiKeyStorageConfig): Promise<ApiKeyRepository>;
}

/** Selects the reference memory store or the configured Deno KV adapter. */
export class DefaultApiKeyRepositoryFactory implements ApiKeyRepositoryFactory {
  readonly #kv_opener: KvDatabaseOpener;

  constructor(options: { kv_opener?: KvDatabaseOpener } = {}) {
    this.#kv_opener = options.kv_opener ?? new DenoKvDatabaseOpener();
  }

  async create(config: ApiKeyStorageConfig): Promise<ApiKeyRepository> {
    if (config.backend === "memory") return new MemoryApiKeyRepository();
    return new DenoKvApiKeyRepository(
      await this.#kv_opener.open(config.path),
    );
  }
}

/**
 * API keys inherit the ownership backend when no override is configured, so
 * durable creator identities cannot silently receive process-local keys.
 * Explicit memory remains available for deliberately ephemeral compositions.
 */
export function parse_api_key_storage_config(
  environment: ApiKeyStorageEnvironmentSource,
  ownership_config: OwnershipStorageConfig,
): ApiKeyStorageConfig {
  if (environment.get(API_KEY_STORAGE_BACKEND_ENV) === undefined) {
    return ownership_config;
  }
  return parse_dependent_storage_config(
    environment,
    API_KEY_STORAGE_BACKEND_ENV,
    ownership_config,
  );
}
