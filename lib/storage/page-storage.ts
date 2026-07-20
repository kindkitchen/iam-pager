import type { PageAggregateRepository } from "../page/aggregate-interfaces.ts";
import type { PageRepository } from "../page/interfaces.ts";
import { DenoKvPageRepository } from "../page/kv-repository.ts";
import { MemoryPageRepository } from "../page/memory-repository.ts";
import { KvPageAggregateRepository } from "./kv-page-aggregate-repository.ts";
import { KvPagesV2ReadinessProbe } from "./pages-v1-to-v2-migration.ts";
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
  | { readonly backend: "deno-kv"; readonly path?: string }
  | { readonly backend: "deno-kv-v2"; readonly path?: string };

export type PagePersistence = PageAggregateRepository | PageRepository;

export interface PageRepositoryFactory {
  create(config: PageStorageConfig): Promise<PagePersistence>;
}

/**
 * Selects memory, the retained schema-v1 fallback, or explicitly gated v2
 * aggregate persistence. A failed v2 gate closes its otherwise-unused gateway.
 */
export class DefaultPageRepositoryFactory implements PageRepositoryFactory {
  readonly #kv_opener: KvDatabaseOpener;

  constructor(options: { kv_opener?: KvDatabaseOpener } = {}) {
    this.#kv_opener = options.kv_opener ?? new DenoKvDatabaseOpener();
  }

  async create(config: PageStorageConfig): Promise<PagePersistence> {
    if (config.backend === "memory") return new MemoryPageRepository();
    const kv = await this.#kv_opener.open(config.path);
    if (config.backend === "deno-kv") {
      return new DenoKvPageRepository(kv);
    }
    try {
      await new KvPagesV2ReadinessProbe(kv).assert_ready();
      return new KvPageAggregateRepository(kv);
    } catch (error) {
      kv.close();
      throw error;
    }
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
  if (backend !== "deno-kv" && backend !== "deno-kv-v2") {
    throw new TypeError(
      `${PAGE_STORAGE_BACKEND_ENV} must be memory, deno-kv, or deno-kv-v2`,
    );
  }
  if (ownership_config.backend !== "deno-kv") {
    throw new TypeError(
      `${PAGE_STORAGE_BACKEND_ENV}=${backend} requires durable ownership through IAM_PAGER_OWNERSHIP_STORAGE_BACKEND=deno-kv`,
    );
  }
  return ownership_config.path === undefined
    ? { backend }
    : { backend, path: ownership_config.path };
}
