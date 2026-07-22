import { assertEquals } from "@std/assert";
import { KvToolboxGateway } from "../storage/kv-toolbox-gateway.ts";
import {
  DenoKvStorageOAuthAttemptRepository,
  MemoryStorageOAuthAttemptRepository,
  type StorageOAuthAttemptRepository,
} from "./storage-oauth-attempt-repository.ts";

const attempt = {
  state_hash: "state-hash",
  session_id: "session-1",
  user_id: "user-1",
  callback_url: "https://pager.example/auth/storage/google-drive/callback",
  attempt_context: "pkce-verifier",
  created_at: new Date("2026-07-22T12:00:00.000Z"),
  expires_at: new Date("2099-07-22T12:10:00.000Z"),
};

async function assert_attempt_contract(
  repository: StorageOAuthAttemptRepository,
): Promise<void> {
  assertEquals(await repository.save(attempt), true);
  assertEquals(await repository.save(attempt), false);
  assertEquals(
    await repository.consume(
      attempt.state_hash,
      "other-session",
      attempt.user_id,
      new Date("2026-07-22T12:01:00.000Z"),
    ),
    null,
  );
  assertEquals(
    await repository.consume(
      attempt.state_hash,
      attempt.session_id,
      attempt.user_id,
      new Date("2026-07-22T12:01:00.000Z"),
    ),
    attempt,
  );
  assertEquals(
    await repository.consume(
      attempt.state_hash,
      attempt.session_id,
      attempt.user_id,
      new Date("2026-07-22T12:01:00.000Z"),
    ),
    null,
  );
}

Deno.test("memory storage OAuth attempts are owner-bound and one-use", async () => {
  await assert_attempt_contract(new MemoryStorageOAuthAttemptRepository());
});

Deno.test("Deno KV storage OAuth attempts use separate one-use records", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const repository = new DenoKvStorageOAuthAttemptRepository(
      new KvToolboxGateway(kv),
    );
    await assert_attempt_contract(repository);
    const entries = [];
    for await (
      const entry of kv.list({
        prefix: ["iam-pager", "storage-oauth-attempts", "google-drive"],
      })
    ) entries.push(entry);
    assertEquals(entries, []);
  } finally {
    kv.close();
  }
});
