import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import type { ExternalStorageProvider } from "./interfaces.ts";
import type { ExternalStorageCapability } from "./model.ts";
import { ExternalStorageProviderRegistry } from "./provider-registry.ts";

function fake_provider(
  provider_id: string,
  capabilities: readonly ExternalStorageCapability[] = ["read"],
): ExternalStorageProvider {
  return {
    provider_id,
    capabilities,
    fetch_content: () =>
      Promise.resolve({ ok: false, reason: "external_content_missing" }),
    stat_content: () =>
      Promise.resolve({ ok: false, reason: "external_content_missing" }),
    ...(capabilities.includes("write")
      ? {
        put_content: () =>
          Promise.resolve({
            ok: false as const,
            reason: "external_source_unreachable" as const,
          }),
      }
      : {}),
    ...(capabilities.includes("delete")
      ? {
        delete_content: () =>
          Promise.resolve({
            ok: false as const,
            reason: "external_source_unreachable" as const,
          }),
      }
      : {}),
  };
}

Deno.test("provider registry resolves adapters independently", () => {
  const first = fake_provider("first");
  const second = fake_provider("second", ["read", "write"]);
  const registry = new ExternalStorageProviderRegistry([first, second]);

  assertStrictEquals(registry.resolve("first"), first);
  assertStrictEquals(registry.resolve("second"), second);
  assertEquals(registry.resolve("unknown"), null);
});

Deno.test("provider registry rejects duplicate and unsafe IDs", () => {
  assertThrows(
    () =>
      new ExternalStorageProviderRegistry([
        fake_provider("drive"),
        fake_provider("drive"),
      ]),
    Error,
    "duplicate external storage provider",
  );
  for (const provider_id of ["", "Drive", "google_drive", "1-drive"]) {
    assertThrows(
      () => new ExternalStorageProviderRegistry([fake_provider(provider_id)]),
      TypeError,
      "invalid external storage provider ID",
    );
  }
});

Deno.test("provider registry requires coherent declared capabilities", () => {
  assertThrows(
    () => new ExternalStorageProviderRegistry([fake_provider("no-read", [])]),
    TypeError,
    "requires read capability",
  );
  assertThrows(
    () =>
      new ExternalStorageProviderRegistry([
        fake_provider("duplicate", ["read", "read"]),
      ]),
    TypeError,
    "duplicate capability",
  );

  const missing_write = fake_provider("missing-write", ["read"]);
  const unexpected_put = {
    ...missing_write,
    put_content: () =>
      Promise.resolve({
        ok: false as const,
        reason: "external_source_unreachable" as const,
      }),
  };
  assertThrows(
    () => new ExternalStorageProviderRegistry([unexpected_put]),
    TypeError,
    "capability write must match put_content",
  );

  const declared_write = {
    ...fake_provider("declared-write", ["read", "write"]),
    put_content: undefined,
  } as unknown as ExternalStorageProvider;
  assertThrows(
    () => new ExternalStorageProviderRegistry([declared_write]),
    TypeError,
    "capability write must match put_content",
  );

  const unknown_capability = {
    ...fake_provider("unknown-capability"),
    capabilities: ["read", "share"],
  } as unknown as ExternalStorageProvider;
  assertThrows(
    () => new ExternalStorageProviderRegistry([unknown_capability]),
    TypeError,
    "invalid capability",
  );
});
