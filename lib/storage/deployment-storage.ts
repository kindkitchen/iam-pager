import {
  OWNERSHIP_DENO_KV_PATH_ENV,
  OWNERSHIP_STORAGE_BACKEND_ENV,
} from "./ownership-storage.ts";
import { PAGE_STORAGE_BACKEND_ENV } from "./page-storage.ts";
import { SESSION_STORAGE_BACKEND_ENV } from "./session-storage.ts";

export const DENO_TIMELINE_ENV = "DENO_TIMELINE";

export interface DeploymentStorageEnvironmentSource {
  get(name: string): string | undefined;
}

const backend_names = new Set([
  OWNERSHIP_STORAGE_BACKEND_ENV,
  SESSION_STORAGE_BACKEND_ENV,
  PAGE_STORAGE_BACKEND_ENV,
]);

/**
 * Revision previews share one remote database and skip pre-deploy today, so
 * force their application repositories to process-local memory. Git branch and
 * production timelines retain their configured durable storage.
 */
export function deployment_storage_environment(
  environment: DeploymentStorageEnvironmentSource,
): DeploymentStorageEnvironmentSource {
  const timeline = environment.get(DENO_TIMELINE_ENV);
  if (timeline === undefined || !timeline.startsWith("preview/")) {
    return environment;
  }
  return {
    get(name: string): string | undefined {
      if (backend_names.has(name)) return "memory";
      if (name === OWNERSHIP_DENO_KV_PATH_ENV) return undefined;
      return environment.get(name);
    },
  };
}
