import {
  AesGcmStorageCredentialCipher,
  DenoKvStorageOAuthAttemptRepository,
  MemoryStorageConnectionRepository,
  MemoryStorageOAuthAttemptRepository,
  STORAGE_TOKEN_KEY_ENV,
  type StorageConnectionRepository,
  type StorageOAuthAttemptRepository,
} from "../external-storage/mod.ts";
import { DenoKvStorageConnectionRepository } from "./kv-storage-connection-repository.ts";
import {
  DenoKvDatabaseOpener,
  type KvDatabaseOpener,
  type OwnershipStorageConfig,
  parse_dependent_storage_config,
  type StorageConfig,
  type StorageEnvironmentSource,
} from "./ownership-storage.ts";

export const STORAGE_CONNECTION_BACKEND_ENV =
  "IAM_PAGER_STORAGE_CONNECTION_BACKEND";

export type StorageConnectionStorageConfig = StorageConfig;

export interface StorageConnectionRepositories {
  readonly connection_repository: StorageConnectionRepository;
  readonly oauth_attempt_repository: StorageOAuthAttemptRepository;
}

export interface StorageConnectionRepositoriesFactory {
  create(
    config: StorageConnectionStorageConfig,
    environment: StorageEnvironmentSource,
  ): Promise<StorageConnectionRepositories>;
}

/** Composes connection metadata, encrypted credentials, and one-use OAuth state. */
export class DefaultStorageConnectionRepositoriesFactory
  implements StorageConnectionRepositoriesFactory {
  readonly #kv_opener: KvDatabaseOpener;

  constructor(options: { kv_opener?: KvDatabaseOpener } = {}) {
    this.#kv_opener = options.kv_opener ?? new DenoKvDatabaseOpener();
  }

  async create(
    config: StorageConnectionStorageConfig,
    environment: StorageEnvironmentSource,
  ): Promise<StorageConnectionRepositories> {
    if (config.backend === "memory") {
      return {
        connection_repository: new MemoryStorageConnectionRepository(),
        oauth_attempt_repository: new MemoryStorageOAuthAttemptRepository(),
      };
    }
    const encoded_key = environment.get(STORAGE_TOKEN_KEY_ENV);
    if (encoded_key === undefined) {
      throw new TypeError(
        `${STORAGE_TOKEN_KEY_ENV} is required for durable storage connections`,
      );
    }
    const cipher = await AesGcmStorageCredentialCipher.from_base64url_key(
      encoded_key,
    );
    const kv = await this.#kv_opener.open(config.path);
    return {
      connection_repository: new DenoKvStorageConnectionRepository(kv, cipher),
      oauth_attempt_repository: new DenoKvStorageOAuthAttemptRepository(kv),
    };
  }
}

/** Durable connections inherit ownership durability unless explicitly ephemeral. */
export function parse_storage_connection_storage_config(
  environment: StorageEnvironmentSource,
  ownership_config: OwnershipStorageConfig,
): StorageConnectionStorageConfig {
  if (environment.get(STORAGE_CONNECTION_BACKEND_ENV) === undefined) {
    return ownership_config;
  }
  return parse_dependent_storage_config(
    environment,
    STORAGE_CONNECTION_BACKEND_ENV,
    ownership_config,
  );
}
