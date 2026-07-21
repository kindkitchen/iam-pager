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
 * Durable API keys inherit the ownership KV path so a stored key's owner
 * user ID cannot outlive or drift away from the configured identity database.
 */
export function parse_api_key_storage_config(
  environment: ApiKeyStorageEnvironmentSource,
  ownership_config: OwnershipStorageConfig,
): ApiKeyStorageConfig {
  return parse_dependent_storage_config(
    environment,
    API_KEY_STORAGE_BACKEND_ENV,
    ownership_config,
  );
}
