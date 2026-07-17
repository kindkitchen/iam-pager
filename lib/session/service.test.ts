import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import type { Clock, CredentialGenerator, IdGenerator } from "./interfaces.ts";
import { MemorySessionRepository } from "./memory-repository.ts";
import {
  default_session_config,
  hash_session_credential,
  type SessionConfig,
  SessionService,
} from "./service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

class FakeClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(duration_ms: number): void {
    this.current = new Date(this.current.getTime() + duration_ms);
  }
}

class SequenceGenerator implements IdGenerator, CredentialGenerator {
  constructor(private readonly values: string[]) {}

  generate(): string {
    const value = this.values.shift();
    if (value === undefined) throw new Error("sequence exhausted");
    return value;
  }
}

function credential(character: string): string {
  return character.repeat(43);
}

function make_fixture(
  config?: Partial<SessionConfig>,
  credential_values = "ABCDEFGHIJKLMNOPQRST".split("").map(credential),
) {
  const repository = new MemorySessionRepository();
  const clock = new FakeClock(new Date("2026-07-17T12:00:00.000Z"));
  const id_generator = new SequenceGenerator(
    Array.from({ length: 20 }, (_, index) => `session-${index + 1}`),
  );
  const credential_generator = new SequenceGenerator(credential_values);
  const service = new SessionService({
    repository,
    clock,
    id_generator,
    credential_generator,
    config: { ...default_session_config, ...config },
  });
  return { repository, clock, service };
}

Deno.test("missing credential creates a guest and valid credential resolves it", async () => {
  const { repository, service } = make_fixture();
  const created = await service.resolve();

  assertEquals(created.session.kind, "guest");
  assertEquals(created.session.session_id, "session-1");
  assertExists(created.credential_to_set);
  assertEquals(repository.size, 1);

  const resolved = await service.resolve(created.credential_to_set.value);
  assertEquals(resolved.session, created.session);
  assertEquals(resolved.credential_to_set, undefined);
  assertEquals(repository.size, 1);
});

Deno.test("malformed and unknown credentials get independent replacement guests", async () => {
  const { repository, service } = make_fixture();

  const malformed = await service.resolve("attacker-chosen");
  const unknown = await service.resolve(credential("z"));

  assertEquals(malformed.session.kind, "guest");
  assertEquals(unknown.session.kind, "guest");
  assertNotEquals(malformed.session.session_id, unknown.session.session_id);
  assertEquals(repository.size, 2);
});

Deno.test("expired and revoked credentials cannot resolve their old session", async () => {
  const { clock, service } = make_fixture();
  const original = await service.resolve();
  assertExists(original.credential_to_set);

  clock.advance(default_session_config.guest_absolute_lifetime_ms);
  const after_expiry = await service.resolve(original.credential_to_set.value);
  assertNotEquals(after_expiry.session.session_id, original.session.session_id);
  assertExists(after_expiry.credential_to_set);

  assertEquals(await service.revoke(after_expiry.session), true);
  const after_revocation = await service.resolve(
    after_expiry.credential_to_set.value,
  );
  assertNotEquals(
    after_revocation.session.session_id,
    after_expiry.session.session_id,
  );
});

Deno.test("repository stores a credential hash and never the bearer value", async () => {
  const { repository, service } = make_fixture();
  const created = await service.resolve();
  assertExists(created.credential_to_set);
  const bearer = created.credential_to_set.value;

  assertEquals(await repository.find_by_credential_hash(bearer), null);
  const stored = await repository.find_by_credential_hash(
    await hash_session_credential(bearer),
  );
  assertExists(stored);
  assertEquals(stored.session_id, created.session.session_id);
  assertNotEquals(stored.credential_hash, bearer);
});

Deno.test("renewal is bounded by the threshold instead of writing every request", async () => {
  const { clock, repository, service } = make_fixture();
  const created = await service.resolve();
  assertExists(created.credential_to_set);
  const bearer = created.credential_to_set.value;
  const original_expiry = created.session.absolute_expires_at;

  clock.advance(DAY_MS - 1);
  const early = await service.resolve(bearer);
  assertEquals(early.credential_to_set, undefined);
  assertEquals(early.session.last_seen_at, created.session.last_seen_at);

  clock.advance(1);
  const renewed = await service.resolve(bearer);
  assertExists(renewed.credential_to_set);
  assertEquals(renewed.credential_to_set.value, bearer);
  assertEquals(renewed.session.last_seen_at, clock.current);
  assertEquals(renewed.session.absolute_expires_at, original_expiry);
  assertEquals(repository.size, 1);

  clock.advance(1);
  const not_repeated = await service.resolve(bearer);
  assertEquals(not_repeated.credential_to_set, undefined);
});

Deno.test("authentication preserves the logical session and rotates its credential", async () => {
  const { service } = make_fixture();
  const guest = await service.resolve();
  assertExists(guest.credential_to_set);
  const old_bearer = guest.credential_to_set.value;

  const result = await service.upgrade(guest.session, "user-1");
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const authenticated = result.resolution;
  assertEquals(authenticated.session.kind, "authenticated");
  if (authenticated.session.kind !== "authenticated") return;
  assertEquals(authenticated.session.session_id, guest.session.session_id);
  assertEquals(authenticated.session.user_id, "user-1");
  assertEquals(
    authenticated.session.session_version,
    guest.session.session_version + 1,
  );
  assertExists(authenticated.credential_to_set);
  assertNotEquals(authenticated.credential_to_set.value, old_bearer);

  const old_resolution = await service.resolve(old_bearer);
  assertEquals(old_resolution.session.kind, "guest");
  assertNotEquals(
    old_resolution.session.session_id,
    authenticated.session.session_id,
  );

  const new_resolution = await service.resolve(
    authenticated.credential_to_set.value,
  );
  assertEquals(new_resolution.session, authenticated.session);
});

Deno.test("credential rotation retries rather than retaining the old bearer", async () => {
  const first = credential("A");
  const { service } = make_fixture(undefined, [
    first,
    first,
    credential("B"),
    credential("C"),
  ]);
  const guest = await service.resolve();

  const result = await service.upgrade(guest.session, "user-1");
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertExists(result.resolution.credential_to_set);
  assertEquals(result.resolution.credential_to_set.value, credential("B"));
  assertNotEquals(result.resolution.credential_to_set.value, first);
});

Deno.test("an expired logical session cannot be upgraded", async () => {
  const { clock, service } = make_fixture();
  const guest = await service.resolve();

  clock.advance(default_session_config.guest_absolute_lifetime_ms);
  assertEquals(await service.upgrade(guest.session, "user-1"), {
    ok: false,
    reason: "stale_session",
  });
});

Deno.test("concurrent upgrades permit one credential rotation only", async () => {
  const { service } = make_fixture();
  const guest = await service.resolve();

  const results = await Promise.all([
    service.upgrade(guest.session, "user-1"),
    service.upgrade(guest.session, "user-1"),
  ]);
  assertEquals(results.filter((result) => result.ok).length, 1);
  assertEquals(
    results.filter((result) => !result.ok && result.reason === "stale_session")
      .length,
    1,
  );
});

Deno.test("concurrent first requests create distinct consistent sessions", async () => {
  const { repository, service } = make_fixture();

  const sessions = await Promise.all([
    service.resolve(),
    service.resolve(),
    service.resolve(),
  ]);

  assertEquals(
    new Set(sessions.map((item) => item.session.session_id)).size,
    3,
  );
  assertEquals(
    new Set(sessions.map((item) => item.credential_to_set?.value)).size,
    3,
  );
  assertEquals(repository.size, 3);
  for (const item of sessions) {
    assertExists(item.credential_to_set);
    const resolved = await service.resolve(item.credential_to_set.value);
    assertEquals(resolved.session.session_id, item.session.session_id);
  }
});
