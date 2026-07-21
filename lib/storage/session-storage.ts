import type { SessionRepository } from "../session/interfaces.ts";
import { DenoKvSessionRepository } from "../session/kv-repository.ts";
import { MemorySessionRepository } from "../session/memory-repository.ts";
import {
  DenoKvDatabaseOpener,
  type KvDatabaseOpener,
  type OwnershipStorageConfig,
  parse_dependent_storage_config,
  type StorageConfig,
  type StorageEnvironmentSource,
} from "./ownership-storage.ts";

export const SESSION_STORAGE_BACKEND_ENV = "IAM_PAGER_SESSION_STORAGE_BACKEND";

export type SessionStorageEnvironmentSource = StorageEnvironmentSource;
export type SessionStorageConfig = StorageConfig;

export interface SessionRepositoryFactory {
  create(config: SessionStorageConfig): Promise<SessionRepository>;
}

/** Selects the reference memory store or the configured Deno KV adapter. */
export class DefaultSessionRepositoryFactory
  implements SessionRepositoryFactory {
  readonly #kv_opener: KvDatabaseOpener;

  constructor(options: { kv_opener?: KvDatabaseOpener } = {}) {
    this.#kv_opener = options.kv_opener ?? new DenoKvDatabaseOpener();
  }

  async create(config: SessionStorageConfig): Promise<SessionRepository> {
    if (config.backend === "memory") return new MemorySessionRepository();
    return new DenoKvSessionRepository(
      await this.#kv_opener.open(config.path),
    );
  }
}

/**
 * Durable authenticated sessions inherit the ownership KV path so their user
 * IDs cannot outlive or drift away from the configured identity database.
 */
export function parse_session_storage_config(
  environment: SessionStorageEnvironmentSource,
  ownership_config: OwnershipStorageConfig,
): SessionStorageConfig {
  return parse_dependent_storage_config(
    environment,
    SESSION_STORAGE_BACKEND_ENV,
    ownership_config,
  );
}
