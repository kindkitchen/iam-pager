import { assertEquals, assertRejects } from "@std/assert";
import type { StorageConnectionRepository } from "../external-storage/connection-repository.ts";
import { test_storage_connection_repository_conformance } from "../external-storage/connection-repository-conformance.ts";
import { AesGcmStorageCredentialCipher } from "../external-storage/token-cipher.ts";
import { KvToolboxGateway } from "./kv-toolbox-gateway.ts";
import { DenoKvStorageConnectionRepository } from "./kv-storage-connection-repository.ts";

const conformance_handles = new WeakMap<object, Deno.Kv>();

async function repository(
  kv: Deno.Kv,
): Promise<DenoKvStorageConnectionRepository> {
  const cipher = await AesGcmStorageCredentialCipher.from_key_bytes(
    new Uint8Array(32).fill(7),
  );
  return new DenoKvStorageConnectionRepository(
    new KvToolboxGateway(kv),
    cipher,
  );
}

test_storage_connection_repository_conformance({
  name: "DenoKvStorageConnectionRepository",
  make_repository: async () => {
    const kv = await Deno.openKv(":memory:");
    const created = await repository(kv);
    conformance_handles.set(created, kv);
    return created;
  },
  teardown: (created) => {
    conformance_handles.get(created)?.close();
    conformance_handles.delete(created);
  },
});

Deno.test("DenoKvStorageConnectionRepository: state is shared and tokens are ciphertext-only", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const writer: StorageConnectionRepository = await repository(kv);
    const connection = {
      connection_id: "connection-1",
      user_id: "user-1",
      provider_id: "google-drive",
      provider_subject: "provider-user-1",
      scopes: ["drive.file"],
      status: "active" as const,
      created_at: new Date("2026-07-22T10:00:00.000Z"),
      updated_at: new Date("2026-07-22T10:00:00.000Z"),
    };
    assertEquals((await writer.create(connection)).ok, true);
    assertEquals(
      await writer.put_credentials("connection-1", {
        access_token: "access-secret",
        refresh_token: "refresh-secret",
      }),
      true,
    );

    const reader: StorageConnectionRepository = await repository(kv);
    assertEquals(await reader.find_by_id("connection-1"), connection);
    assertEquals(await reader.get_credentials("connection-1"), {
      access_token: "access-secret",
      refresh_token: "refresh-secret",
    });

    const stored_values: unknown[] = [];
    for await (
      const entry of kv.list({ prefix: ["iam-pager", "storage-connections"] })
    ) {
      stored_values.push(entry.value);
    }
    const serialized = JSON.stringify(stored_values);
    assertEquals(serialized.includes("access-secret"), false);
    assertEquals(serialized.includes("refresh-secret"), false);
    assertEquals(serialized.includes("access_token"), false);
    assertEquals(serialized.includes("refresh_token"), false);
  } finally {
    kv.close();
  }
});

Deno.test("DenoKvStorageConnectionRepository: malformed metadata fails closed", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const reader = await repository(kv);
    await kv.set(
      ["iam-pager", "storage-connections", "by-id", "connection-1"],
      {
        connection_id: "connection-1",
        user_id: "user-1",
        provider_id: "Google",
        provider_subject: "subject",
        scopes: ["drive.file"],
        status: "active",
        created_at: new Date("2026-07-22T10:00:00.000Z"),
        updated_at: new Date("2026-07-22T10:00:00.000Z"),
      },
    );
    await assertRejects(
      async () => await reader.find_by_id("connection-1"),
      TypeError,
      "invalid stored storage connection record",
    );
  } finally {
    kv.close();
  }
});
