import type { PageAggregateRepository } from "../page/aggregate-interfaces.ts";
import { MemoryPageAggregateRepository } from "../page/memory-aggregate-repository.ts";
import { KvPageAggregateRepository } from "./kv-page-aggregate-repository.ts";
import {
  DenoKvDatabaseOpener,
  type KvDatabaseOpener,
  type OwnershipStorageConfig,
  parse_dependent_storage_config,
  type StorageConfig,
  type StorageEnvironmentSource,
} from "./ownership-storage.ts";

export const PAGE_STORAGE_BACKEND_ENV = "IAM_PAGER_PAGE_STORAGE_BACKEND";

export type PageStorageEnvironmentSource = StorageEnvironmentSource;
export type PageStorageConfig = StorageConfig;

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
  return parse_dependent_storage_config(
    environment,
    PAGE_STORAGE_BACKEND_ENV,
    ownership_config,
  );
}
