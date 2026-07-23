import { assertThrows } from "@std/assert";
import { OWNERSHIP_STORAGE_BACKEND_ENV } from "./ownership-storage.ts";
import {
  LEGACY_PAGE_STORAGE_BACKEND_ENV,
  PAGE_STORAGE_BACKEND_ENV,
} from "./page-storage.ts";
import {
  DENO_KV_ACCESS_TOKEN_ENV,
  DENO_KV_ID_ENV,
  require_explicit_runtime_storage_selection,
} from "./runtime-storage.ts";
import { SESSION_STORAGE_BACKEND_ENV } from "./session-storage.ts";

function environment(values: Readonly<Record<string, string>>) {
  return { get: (name: string) => values[name] };
}

Deno.test("configured runtime rejects implicit process-local storage", () => {
  assertThrows(
    () => require_explicit_runtime_storage_selection(environment({})),
    TypeError,
    `missing ${OWNERSHIP_STORAGE_BACKEND_ENV}, ${SESSION_STORAGE_BACKEND_ENV}, ${PAGE_STORAGE_BACKEND_ENV}`,
  );
});

Deno.test("Deno KV connection hints cannot silently leave local repositories in memory", () => {
  for (const hint of [DENO_KV_ID_ENV, DENO_KV_ACCESS_TOKEN_ENV]) {
    assertThrows(
      () =>
        require_explicit_runtime_storage_selection(
          environment({ [hint]: "configured" }),
        ),
      TypeError,
      "do not select application repositories",
    );
  }
});

Deno.test("runtime accepts complete explicit storage selection including the legacy page selector", () => {
  for (
    const page_selector of [
      PAGE_STORAGE_BACKEND_ENV,
      LEGACY_PAGE_STORAGE_BACKEND_ENV,
    ]
  ) {
    require_explicit_runtime_storage_selection(
      environment({
        [OWNERSHIP_STORAGE_BACKEND_ENV]: "deno-kv",
        [SESSION_STORAGE_BACKEND_ENV]: "deno-kv",
        [page_selector]: "deno-kv",
        [DENO_KV_ID_ENV]: "configured",
        [DENO_KV_ACCESS_TOKEN_ENV]: "configured",
      }),
    );
  }
});
