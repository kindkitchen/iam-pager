import type { SessionRepository } from "../session/interfaces.ts";
import { DenoKvSessionRepository } from "../session/kv-repository.ts";
import { MemorySessionRepository } from "../session/memory-repository.ts";
import {
  DenoKvDatabaseOpener,
  type KvDatabaseOpener,
  type OwnershipStorageConfig,
} from "./ownership-storage.ts";

export const SESSION_STORAGE_BACKEND_ENV = "IAM_PAGER_SESSION_STORAGE_BACKEND";

export interface SessionStorageEnvironmentSource {
  get(name: string): string | undefined;
}

export type SessionStorageConfig =
  | { readonly backend: "memory" }
  | { readonly backend: "deno-kv"; readonly path?: string };

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
  const backend = environment.get(SESSION_STORAGE_BACKEND_ENV);
  if (backend === undefined || backend === "memory") {
    return { backend: "memory" };
  }
  if (backend !== "deno-kv") {
    throw new TypeError(
      `${SESSION_STORAGE_BACKEND_ENV} must be memory or deno-kv`,
    );
  }
  if (ownership_config.backend !== "deno-kv") {
    throw new TypeError(
      `${SESSION_STORAGE_BACKEND_ENV}=deno-kv requires durable ownership through IAM_PAGER_OWNERSHIP_STORAGE_BACKEND=deno-kv`,
    );
  }
  return ownership_config.path === undefined
    ? { backend: "deno-kv" }
    : { backend: "deno-kv", path: ownership_config.path };
}
