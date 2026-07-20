import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  DENO_TIMELINE_ENV,
  deployment_storage_environment,
  type DeploymentStorageEnvironmentSource,
} from "./deployment-storage.ts";
import {
  OWNERSHIP_DENO_KV_PATH_ENV,
  OWNERSHIP_STORAGE_BACKEND_ENV,
} from "./ownership-storage.ts";
import { PAGE_STORAGE_BACKEND_ENV } from "./page-storage.ts";
import { SESSION_STORAGE_BACKEND_ENV } from "./session-storage.ts";

function environment(
  values: Readonly<Record<string, string>>,
): DeploymentStorageEnvironmentSource {
  return { get: (name) => values[name] };
}

Deno.test("deployment storage preserves local, branch, and production configuration", () => {
  for (const timeline of [undefined, "production", "git-branch/feature"]) {
    const source = environment({
      ...(timeline === undefined ? {} : { [DENO_TIMELINE_ENV]: timeline }),
      [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
    });
    assertStrictEquals(deployment_storage_environment(source), source);
  }
});

Deno.test("revision previews force every linked repository to memory", () => {
  const source = environment({
    [DENO_TIMELINE_ENV]: "preview/revision-id",
    [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
    [OWNERSHIP_DENO_KV_PATH_ENV]: "/durable/shared-preview.kv",
    [SESSION_STORAGE_BACKEND_ENV]: "deno-kv",
    [PAGE_STORAGE_BACKEND_ENV]: "deno-kv",
    UNRELATED: "kept",
  });
  const selected = deployment_storage_environment(source);

  assertEquals(selected.get(OWNERSHIP_STORAGE_BACKEND_ENV), "memory");
  assertEquals(selected.get(SESSION_STORAGE_BACKEND_ENV), "memory");
  assertEquals(selected.get(PAGE_STORAGE_BACKEND_ENV), "memory");
  assertEquals(selected.get(OWNERSHIP_DENO_KV_PATH_ENV), undefined);
  assertEquals(selected.get("UNRELATED"), "kept");
  assertEquals(selected.get(DENO_TIMELINE_ENV), "preview/revision-id");
});
