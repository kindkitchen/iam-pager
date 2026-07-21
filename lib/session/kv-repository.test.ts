import { assertEquals, assertRejects } from "@std/assert";
import { KvToolboxGateway } from "../storage/kv-toolbox-gateway.ts";
import type { SessionRepository } from "./interfaces.ts";
import { DenoKvSessionRepository } from "./kv-repository.ts";
import type { SessionRecord } from "./model.ts";
import { test_session_repository_conformance } from "./repository-conformance.ts";

const conformance_handles = new WeakMap<object, Deno.Kv>();

function gateway(kv: Deno.Kv): KvToolboxGateway {
  return new KvToolboxGateway(kv);
}

test_session_repository_conformance({
  name: "DenoKvSessionRepository",
  make_repository: async () => {
    const kv = await Deno.openKv(":memory:");
    const repository = new DenoKvSessionRepository(gateway(kv));
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
    const writer: SessionRepository = new DenoKvSessionRepository(gateway(kv));
    assertEquals(await writer.create(guest_record()), true);

    const reader: SessionRepository = new DenoKvSessionRepository(gateway(kv));
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
    const stored = (await kv.get<Record<string, unknown>>(record_key)).value!;
    await kv.set(record_key, { ...stored, session_id: "wrong-session" });
    await assertRejects(
      () => reader.find_by_credential_hash("durable-credential-hash"),
      Error,
      "session repository invariant violated",
    );
  } finally {
    kv.close();
  }
});
