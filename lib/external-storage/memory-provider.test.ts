import { assertEquals, assertThrows } from "@std/assert";
import { MemoryExternalStorageProvider } from "./memory-provider.ts";
import type { ExternalContentRef } from "./model.ts";
import { test_external_storage_provider_conformance } from "./provider-conformance.ts";

function content_ref(external_ref: string): ExternalContentRef {
  return {
    provider_id: "memory",
    connection_id: "connection-1",
    external_ref,
    version_hint: "version-1",
  };
}

test_external_storage_provider_conformance({
  name: "MemoryExternalStorageProvider",
  make_fixture: () => {
    const provider = new MemoryExternalStorageProvider();
    const existing_ref = content_ref("existing");
    const existing_body = new Uint8Array([1, 2, 3, 4]);
    const unreachable_ref = content_ref("unreachable");
    provider.seed_content(existing_ref, existing_body);
    provider.set_fault(unreachable_ref, "external_source_unreachable");
    return {
      provider,
      existing_ref,
      existing_body,
      missing_ref: content_ref("missing"),
      unreachable_ref,
      put_input: {
        connection_id: "connection-1",
        body: new Uint8Array([5, 6, 7]),
        media_type: "application/octet-stream",
        download_filename: "content.bin",
      },
    };
  },
});

Deno.test("memory provider isolates seeded and written byte arrays", async () => {
  const provider = new MemoryExternalStorageProvider();
  const seeded_ref = content_ref("seeded");
  const seeded_body = new Uint8Array([1, 2]);
  provider.seed_content(seeded_ref, seeded_body);
  seeded_body[0] = 9;
  assertEquals(
    await provider.fetch_content({ content_ref: seeded_ref, max_bytes: 2 }),
    {
      ok: true,
      value: {
        body: new Uint8Array([1, 2]),
        stat: { size_bytes: 2, version_hint: "version-1" },
      },
    },
  );

  const written_body = new Uint8Array([3, 4]);
  const written = await provider.put_content({
    connection_id: "connection-1",
    body: written_body,
    media_type: "application/octet-stream",
  });
  assertEquals(written.ok, true);
  if (!written.ok) return;
  written_body[0] = 9;
  const fetched = await provider.fetch_content({
    content_ref: written.value,
    max_bytes: 2,
  });
  assertEquals(fetched.ok && fetched.value.body, new Uint8Array([3, 4]));
});

Deno.test("memory provider fault injection distinguishes missing and unreachable", async () => {
  const provider = new MemoryExternalStorageProvider();
  const ref = content_ref("faulted");
  provider.seed_content(ref, new Uint8Array([1]));
  provider.set_fault(ref, "external_content_missing");
  assertEquals(await provider.stat_content(ref), {
    ok: false,
    reason: "external_content_missing",
  });
  provider.set_fault(ref, "external_source_unreachable");
  assertEquals(await provider.stat_content(ref), {
    ok: false,
    reason: "external_source_unreachable",
  });
  provider.set_fault(ref, null);
  assertEquals(await provider.stat_content(ref), {
    ok: true,
    value: { size_bytes: 1, version_hint: "version-1" },
  });
});

Deno.test("memory provider rejects malformed or cross-provider calls", () => {
  const provider = new MemoryExternalStorageProvider();
  assertThrows(() => new MemoryExternalStorageProvider("Memory"), TypeError);
  assertThrows(
    () =>
      provider.fetch_content({
        content_ref: { ...content_ref("object"), provider_id: "other" },
        max_bytes: 10,
      }),
    TypeError,
    "another provider",
  );
  assertThrows(
    () =>
      provider.fetch_content({
        content_ref: content_ref("object"),
        max_bytes: -1,
      }),
    TypeError,
    "max_bytes",
  );
});
