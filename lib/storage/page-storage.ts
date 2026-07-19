import type { PageRepository } from "../page/interfaces.ts";
import { DenoKvPageRepository } from "../page/kv-repository.ts";
import { MemoryPageRepository } from "../page/memory-repository.ts";
import {
  DenoKvDatabaseOpener,
  type KvDatabaseOpener,
  type OwnershipStorageConfig,
} from "./ownership-storage.ts";

/** Retained deployment variable name for configuration continuity. */
export const PAGE_STORAGE_BACKEND_ENV = "IAM_PAGER_CONTENT_STORAGE_BACKEND";

export interface PageStorageEnvironmentSource {
  get(name: string): string | undefined;
}

export type PageStorageConfig =
  | { readonly backend: "memory" }
  | { readonly backend: "deno-kv"; readonly path?: string };

export interface PageRepositoryFactory {
  create(config: PageStorageConfig): Promise<PageRepository>;
}

/** Selects the reference memory store or the configured Deno KV page adapter. */
export class DefaultPageRepositoryFactory implements PageRepositoryFactory {
  readonly #kv_opener: KvDatabaseOpener;

  constructor(options: { kv_opener?: KvDatabaseOpener } = {}) {
    this.#kv_opener = options.kv_opener ?? new DenoKvDatabaseOpener();
  }

  async create(config: PageStorageConfig): Promise<PageRepository> {
    if (config.backend === "memory") return new MemoryPageRepository();
    return new DenoKvPageRepository(
      await this.#kv_opener.open(config.path),
    );
  }
}

/**
 * Durable pages inherit the ownership KV path: a managed page must not outlive
 * the reservation and user record that authorize it.
 */
export function parse_page_storage_config(
  environment: PageStorageEnvironmentSource,
  ownership_config: OwnershipStorageConfig,
): PageStorageConfig {
  const backend = environment.get(PAGE_STORAGE_BACKEND_ENV);
  if (backend === undefined || backend === "memory") {
    return { backend: "memory" };
  }
  if (backend !== "deno-kv") {
    throw new TypeError(
      `${PAGE_STORAGE_BACKEND_ENV} must be memory or deno-kv`,
    );
  }
  if (ownership_config.backend !== "deno-kv") {
    throw new TypeError(
      `${PAGE_STORAGE_BACKEND_ENV}=deno-kv requires durable ownership through IAM_PAGER_OWNERSHIP_STORAGE_BACKEND=deno-kv`,
    );
  }
  return ownership_config.path === undefined
    ? { backend: "deno-kv" }
    : { backend: "deno-kv", path: ownership_config.path };
}
