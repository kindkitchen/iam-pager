import type {
  IdentityRepository,
  UserIdGenerator,
} from "../auth/interfaces.ts";
import { DenoKvIdentityRepository } from "../auth/kv-identity-repository.ts";
import { MemoryIdentityRepository } from "../auth/memory-identity-repository.ts";
import type { NamespaceRepository } from "../namespace/interfaces.ts";
import { DenoKvNamespaceRepository } from "../namespace/kv-repository.ts";
import { MemoryNamespaceRepository } from "../namespace/memory-repository.ts";
import type { KvGateway } from "./kv-gateway.ts";
import { KvToolboxGateway } from "./kv-toolbox-gateway.ts";

export const OWNERSHIP_STORAGE_BACKEND_ENV =
  "IAM_PAGER_OWNERSHIP_STORAGE_BACKEND";
export const OWNERSHIP_DENO_KV_PATH_ENV = "IAM_PAGER_OWNERSHIP_DENO_KV_PATH";

const max_kv_path_length = 4096;

export interface OwnershipStorageEnvironmentSource {
  get(name: string): string | undefined;
}

export type OwnershipStorageConfig =
  | { readonly backend: "memory" }
  | { readonly backend: "deno-kv"; readonly path?: string };

export interface OwnershipRepositories {
  readonly identity_repository: IdentityRepository;
  readonly namespace_repository: NamespaceRepository;
}

export interface OwnershipRepositoryFactoryDependencies {
  readonly user_id_generator: UserIdGenerator;
}

export interface OwnershipRepositoryFactory {
  create(
    config: OwnershipStorageConfig,
    dependencies: OwnershipRepositoryFactoryDependencies,
  ): Promise<OwnershipRepositories>;
}

/** Runtime boundary that opens the one project-owned KV gateway. */
export interface KvDatabaseOpener {
  open(path?: string): Promise<KvGateway>;
}

export class DenoKvDatabaseOpener implements KvDatabaseOpener {
  async open(path?: string): Promise<KvGateway> {
    return new KvToolboxGateway(await Deno.openKv(path));
  }
}

/**
 * Composes identity and namespace repositories as one ownership persistence
 * choice, preventing durable claims from pointing at process-local user IDs.
 */
export class DefaultOwnershipRepositoryFactory
  implements OwnershipRepositoryFactory {
  readonly #kv_opener: KvDatabaseOpener;

  constructor(options: { kv_opener?: KvDatabaseOpener } = {}) {
    this.#kv_opener = options.kv_opener ?? new DenoKvDatabaseOpener();
  }

  async create(
    config: OwnershipStorageConfig,
    dependencies: OwnershipRepositoryFactoryDependencies,
  ): Promise<OwnershipRepositories> {
    if (config.backend === "memory") {
      return {
        identity_repository: new MemoryIdentityRepository(
          dependencies.user_id_generator,
        ),
        namespace_repository: new MemoryNamespaceRepository(),
      };
    }

    const kv = await this.#kv_opener.open(config.path);
    return {
      identity_repository: new DenoKvIdentityRepository(
        kv,
        dependencies.user_id_generator,
      ),
      namespace_repository: new DenoKvNamespaceRepository(kv),
    };
  }
}

/**
 * Selects the referentially linked ownership stores together. Unset
 * configuration deliberately preserves both in-memory implementations.
 */
export function parse_ownership_storage_config(
  environment: OwnershipStorageEnvironmentSource,
): OwnershipStorageConfig {
  const backend = environment.get(OWNERSHIP_STORAGE_BACKEND_ENV);
  const path = environment.get(OWNERSHIP_DENO_KV_PATH_ENV);

  if (backend === undefined || backend === "memory") {
    if (path !== undefined) {
      throw new TypeError(
        `${OWNERSHIP_DENO_KV_PATH_ENV} requires ${OWNERSHIP_STORAGE_BACKEND_ENV}=deno-kv`,
      );
    }
    return { backend: "memory" };
  }

  if (backend !== "deno-kv") {
    throw new TypeError(
      `${OWNERSHIP_STORAGE_BACKEND_ENV} must be memory or deno-kv`,
    );
  }

  if (path === undefined) return { backend: "deno-kv" };
  if (
    path.length === 0 || path.length > max_kv_path_length ||
    path.trim() !== path
  ) {
    throw new TypeError(
      `${OWNERSHIP_DENO_KV_PATH_ENV} must be an unpadded non-empty path of at most ${max_kv_path_length} characters`,
    );
  }
  return { backend: "deno-kv", path };
}
