import type { PageAggregateRepository } from "../page/aggregate-interfaces.ts";
import { MemoryPageAggregateRepository } from "../page/memory-aggregate-repository.ts";
import { KvPageAggregateRepository } from "./kv-page-aggregate-repository.ts";
import {
  DenoKvDatabaseOpener,
  type KvDatabaseOpener,
  type OwnershipStorageConfig,
} from "./ownership-storage.ts";

export const PAGE_STORAGE_BACKEND_ENV = "IAM_PAGER_PAGE_STORAGE_BACKEND";

export interface PageStorageEnvironmentSource {
  get(name: string): string | undefined;
}

export type PageStorageConfig =
  | { readonly backend: "memory" }
  | { readonly backend: "deno-kv"; readonly path?: string };

export interface PageAggregateRepositoryFactory {
  create(config: PageStorageConfig): Promise<PageAggregateRepository>;
}

/** Selects one implementation of the current page aggregate contract. */
export class DefaultPageAggregateRepositoryFactory
  implements PageAggregateRepositoryFactory {
  readonly #kv_opener: KvDatabaseOpener;

  constructor(options: { kv_opener?: KvDatabaseOpener } = {}) {
    this.#kv_opener = options.kv_opener ?? new DenoKvDatabaseOpener();
  }

  async create(config: PageStorageConfig): Promise<PageAggregateRepository> {
    if (config.backend === "memory") {
      return new MemoryPageAggregateRepository();
    }
    return new KvPageAggregateRepository(
      await this.#kv_opener.open(config.path),
    );
  }
}

/** Durable pages share ownership storage so their authority survives with them. */
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
