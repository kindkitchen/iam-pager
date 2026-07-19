import { assertEquals, assertRejects } from "@std/assert";
import type { SessionRepository } from "./interfaces.ts";
import { DenoKvSessionRepository } from "./kv-repository.ts";
import type { SessionRecord } from "./model.ts";
import { test_session_repository_conformance } from "./repository-conformance.ts";

const conformance_handles = new WeakMap<object, Deno.Kv>();

test_session_repository_conformance({
  name: "DenoKvSessionRepository",
  make_repository: async () => {
    const kv = await Deno.openKv(":memory:");
    const repository = new DenoKvSessionRepository(kv);
    conformance_handles.set(repository, kv);
    return repository;
  },
  teardown: (repository) => {
    conformance_handles.get(repository)?.close();
    conformance_handles.delete(repository);
  },
});

function guest_record(): SessionRecord {
  return {
    kind: "guest",
    session_id: "durable-session",
    session_version: 1,
    created_at: new Date("2026-07-18T00:00:00.000Z"),
    last_seen_at: new Date("2026-07-18T00:00:00.000Z"),
    absolute_expires_at: new Date("2026-07-25T00:00:00.000Z"),
    credential_hash: "durable-credential-hash",
    revoked_at: null,
    authentication_attempts: [],
  };
}

Deno.test("DenoKvSessionRepository: state is shared outside repository instances", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const writer: SessionRepository = new DenoKvSessionRepository(kv);
    assertEquals(await writer.create(guest_record()), true);

    const reader: SessionRepository = new DenoKvSessionRepository(kv);
    assertEquals(
      await reader.find_by_credential_hash("durable-credential-hash"),
      guest_record(),
    );
    const record_key = [
      "iam-pager",
      "sessions",
      "by-id",
      "durable-session",
    ];
    assertEquals((await kv.get(record_key)).value, {
      schema_version: 1,
      kind: "guest",
      session_id: "durable-session",
      session_version: 1,
      created_at: "2026-07-18T00:00:00.000Z",
      last_seen_at: "2026-07-18T00:00:00.000Z",
      absolute_expires_at: "2026-07-25T00:00:00.000Z",
      credential_hash: "durable-credential-hash",
      revoked_at: null,
      authentication_attempts: [],
    });
    assertEquals(
      (await kv.get([
        "iam-pager",
        "sessions",
        "by-credential",
        "durable-credential-hash",
      ])).value,
      { schema_version: 1, session_id: "durable-session" },
    );

    await kv.set(record_key, {
      schema_version: 1,
      kind: "guest",
      session_id: "wrong-session",
      session_version: 1,
      created_at: "2026-07-18T00:00:00.000Z",
      last_seen_at: "2026-07-18T00:00:00.000Z",
      absolute_expires_at: "2026-07-25T00:00:00.000Z",
      credential_hash: "durable-credential-hash",
      revoked_at: null,
      authentication_attempts: [],
    });
    await assertRejects(
      () => reader.find_by_credential_hash("durable-credential-hash"),
      Error,
      "session repository invariant violated",
    );
  } finally {
    kv.close();
  }
});
