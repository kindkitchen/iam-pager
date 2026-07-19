import type { ContentRepository } from "../content/interfaces.ts";
import { DenoKvContentRepository } from "../content/kv-repository.ts";
import { MemoryContentRepository } from "../content/memory-repository.ts";
import {
  DenoKvDatabaseOpener,
  type KvDatabaseOpener,
  type OwnershipStorageConfig,
} from "./ownership-storage.ts";

export const CONTENT_STORAGE_BACKEND_ENV = "IAM_PAGER_CONTENT_STORAGE_BACKEND";

export interface ContentStorageEnvironmentSource {
  get(name: string): string | undefined;
}

export type ContentStorageConfig =
  | { readonly backend: "memory" }
  | { readonly backend: "deno-kv"; readonly path?: string };

export interface ContentRepositoryFactory {
  create(config: ContentStorageConfig): Promise<ContentRepository>;
}

/** Selects the reference memory store or the configured Deno KV adapter. */
export class DefaultContentRepositoryFactory
  implements ContentRepositoryFactory {
  readonly #kv_opener: KvDatabaseOpener;

  constructor(options: { kv_opener?: KvDatabaseOpener } = {}) {
    this.#kv_opener = options.kv_opener ?? new DenoKvDatabaseOpener();
  }

  async create(config: ContentStorageConfig): Promise<ContentRepository> {
    if (config.backend === "memory") return new MemoryContentRepository();
    return new DenoKvContentRepository(
      await this.#kv_opener.open(config.path),
    );
  }
}

/**
 * Durable pages inherit the ownership KV path: a page in a reserved namespace
 * must not outlive the reservation and user record that authorize it, so
 * durable content requires durable ownership in the same database.
 */
export function parse_content_storage_config(
  environment: ContentStorageEnvironmentSource,
  ownership_config: OwnershipStorageConfig,
): ContentStorageConfig {
  const backend = environment.get(CONTENT_STORAGE_BACKEND_ENV);
  if (backend === undefined || backend === "memory") {
    return { backend: "memory" };
  }
  if (backend !== "deno-kv") {
    throw new TypeError(
      `${CONTENT_STORAGE_BACKEND_ENV} must be memory or deno-kv`,
    );
  }
  if (ownership_config.backend !== "deno-kv") {
    throw new TypeError(
      `${CONTENT_STORAGE_BACKEND_ENV}=deno-kv requires durable ownership through IAM_PAGER_OWNERSHIP_STORAGE_BACKEND=deno-kv`,
    );
  }
  return ownership_config.path === undefined
    ? { backend: "deno-kv" }
    : { backend: "deno-kv", path: ownership_config.path };
}
