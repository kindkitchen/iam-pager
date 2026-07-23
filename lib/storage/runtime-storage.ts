import {
  OWNERSHIP_STORAGE_BACKEND_ENV,
  type StorageEnvironmentSource,
} from "./ownership-storage.ts";
import {
  LEGACY_PAGE_STORAGE_BACKEND_ENV,
  PAGE_STORAGE_BACKEND_ENV,
} from "./page-storage.ts";
import { SESSION_STORAGE_BACKEND_ENV } from "./session-storage.ts";

export const DENO_KV_ID_ENV = "DENO_KV_ID";
export const DENO_KV_ACCESS_TOKEN_ENV = "DENO_KV_ACCESS_TOKEN";

/** Prevents a configured runtime from silently composing process-local state. */
export function require_explicit_runtime_storage_selection(
  environment: StorageEnvironmentSource,
): void {
  const selectors = [
    {
      name: OWNERSHIP_STORAGE_BACKEND_ENV,
      configured: environment.get(OWNERSHIP_STORAGE_BACKEND_ENV) !== undefined,
    },
    {
      name: SESSION_STORAGE_BACKEND_ENV,
      configured: environment.get(SESSION_STORAGE_BACKEND_ENV) !== undefined,
    },
    {
      name: PAGE_STORAGE_BACKEND_ENV,
      configured: environment.get(PAGE_STORAGE_BACKEND_ENV) !== undefined ||
        environment.get(LEGACY_PAGE_STORAGE_BACKEND_ENV) !== undefined,
    },
  ] as const;
  const missing = selectors.filter((selector) => !selector.configured).map(
    (selector) => selector.name,
  );
  if (missing.length === 0) return;

  throw new TypeError(
    `application storage backends must be explicit for a configured runtime; missing ${
      missing.join(", ")
    }. ` +
      `${DENO_KV_ID_ENV} and ${DENO_KV_ACCESS_TOKEN_ENV} do not select application repositories; ` +
      "set every missing selector to memory or deno-kv",
  );
}
