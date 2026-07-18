import { assertEquals, assertExists } from "@std/assert";
import type {
  RepositoryAuthenticationAttemptSave,
  SessionRepository,
  SessionUpgrade,
} from "./interfaces.ts";
import type { SessionAuthenticationAttempt, SessionRecord } from "./model.ts";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const base_time = new Date("2026-07-18T10:00:00.000Z");

export interface SessionRepositoryConformanceOptions {
  /** Implementation name used as the test-name prefix. */
  readonly name: string;
  /** Must return a fresh, empty repository for every test. */
  readonly make_repository: () =>
    | SessionRepository
    | Promise<SessionRepository>;
  /** Optional per-test cleanup (close connections, drop state). */
  readonly teardown?: (
    repository: SessionRepository,
  ) => void | Promise<void>;
}

function at(offset_ms: number): Date {
  return new Date(base_time.getTime() + offset_ms);
}

function guest_record(
  session_id = "session-1",
  credential_hash = "credential-1",
): SessionRecord {
  return {
    kind: "guest",
    session_id,
    session_version: 1,
    created_at: at(0),
    last_seen_at: at(0),
    absolute_expires_at: at(7 * DAY_MS),
    credential_hash,
    revoked_at: null,
    authentication_attempts: [],
  };
}

function authenticated_record(
  session_id = "session-authenticated",
  credential_hash = "credential-authenticated",
): SessionRecord {
  return {
    kind: "authenticated",
    session_id,
    session_version: 2,
    user_id: "user-1",
    created_at: at(0),
    last_seen_at: at(HOUR_MS),
    authenticated_at: at(HOUR_MS),
    absolute_expires_at: at(90 * DAY_MS),
    idle_expires_at: at(30 * DAY_MS),
    csrf_token: "csrf-token",
    credential_hash,
    revoked_at: null,
    authentication_attempts: [],
  };
}

function authentication_attempt(
  state_hash: string,
  options: {
    strategy_id?: string;
    created_at?: Date;
    expires_at?: Date;
  } = {},
): SessionAuthenticationAttempt {
  return {
    strategy_id: options.strategy_id ?? "google",
    state_hash,
    callback_url: "https://pager.example/auth/google/callback",
    return_to: "/site/account",
    attempt_context: `context-${state_hash}`,
    created_at: options.created_at ?? at(HOUR_MS),
    expires_at: options.expires_at ?? at(HOUR_MS + 10 * MINUTE_MS),
  };
}

function attempt_save(
  attempt: SessionAuthenticationAttempt,
  max_pending_attempts = 5,
): RepositoryAuthenticationAttemptSave {
  return {
    session_id: "session-1",
    expected_version: 1,
    attempt,
    max_pending_attempts,
  };
}

function upgrade_input(
  credential_hash: string,
  session_id = "session-1",
): SessionUpgrade {
  return {
    session_id,
    expected_version: 1,
    credential_hash,
    csrf_token: "rotated-csrf-token",
    user_id: "user-1",
    authenticated_at: at(2 * HOUR_MS),
    absolute_expires_at: at(90 * DAY_MS),
    idle_expires_at: at(30 * DAY_MS),
  };
}

/** Registers the complete atomic `SessionRepository` contract for a backend. */
export function test_session_repository_conformance(
  options: SessionRepositoryConformanceOptions,
): void {
  const conformance_test = (
    label: string,
    run: (repository: SessionRepository) => Promise<void>,
  ) => {
    Deno.test(`${options.name}: ${label}`, async () => {
      const repository = await options.make_repository();
      try {
        await run(repository);
      } finally {
        await options.teardown?.(repository);
      }
    });
  };

  conformance_test(
    "creates, resolves, and isolates mutable record values",
    async (repository) => {
      assertEquals(
        await repository.find_by_credential_hash("missing"),
        null,
      );
      const input = guest_record();
      const creation = repository.create(input);
      input.created_at.setUTCFullYear(2000);
      assertEquals(await creation, true);

      const found = await repository.find_by_credential_hash("credential-1");
      assertExists(found);
      assertEquals(found.created_at, at(0));
      found.created_at.setUTCFullYear(2001);
      assertEquals(
        (await repository.find_by_credential_hash("credential-1"))?.created_at,
        at(0),
      );
    },
  );

  conformance_test(
    "create enforces unique logical IDs and credentials atomically",
    async (repository) => {
      assertEquals(await repository.create(guest_record()), true);
      assertEquals(
        await repository.create(guest_record("session-1", "credential-2")),
        false,
      );
      assertEquals(
        await repository.create(guest_record("session-2", "credential-1")),
        false,
      );
      assertEquals(
        await repository.find_by_credential_hash("credential-2"),
        null,
      );
      assertEquals(
        (await repository.find_by_credential_hash("credential-1"))?.session_id,
        "session-1",
      );
    },
  );

  conformance_test(
    "concurrent create has one winner without a dangling credential",
    async (repository) => {
      const records = ["credential-a", "credential-b", "credential-c"].map(
        (credential_hash) => guest_record("shared-session", credential_hash),
      );
      const results = await Promise.all(
        records.map((record) => repository.create(record)),
      );
      assertEquals(results.filter(Boolean).length, 1);
      const winner_index = results.findIndex(Boolean);
      assertEquals(
        (
          await repository.find_by_credential_hash(
            records[winner_index].credential_hash,
          )
        )?.session_id,
        "shared-session",
      );
      for (const [index, record] of records.entries()) {
        if (index === winner_index) continue;
        assertEquals(
          await repository.find_by_credential_hash(record.credential_hash),
          null,
        );
      }
    },
  );

  conformance_test(
    "renewal is monotonic and rejects stale logical versions",
    async (repository) => {
      await repository.create(guest_record());
      const renewed = await repository.renew(
        "session-1",
        1,
        at(2 * HOUR_MS),
      );
      assertEquals(renewed?.last_seen_at, at(2 * HOUR_MS));

      const older = await repository.renew(
        "session-1",
        1,
        at(HOUR_MS),
      );
      assertEquals(older?.last_seen_at, at(2 * HOUR_MS));
      assertEquals(
        await repository.renew("session-1", 2, at(3 * HOUR_MS)),
        null,
      );
    },
  );

  conformance_test(
    "authentication attempts are guest-only, live, bounded, and unique",
    async (repository) => {
      await repository.create(guest_record());
      const expired = authentication_attempt("expired", {
        created_at: at(0),
        expires_at: at(MINUTE_MS),
      });
      const first = authentication_attempt("first", {
        created_at: at(2 * MINUTE_MS),
        expires_at: at(HOUR_MS),
      });
      const second = authentication_attempt("second", {
        created_at: at(3 * MINUTE_MS),
        expires_at: at(HOUR_MS),
      });

      assertEquals(
        await repository.save_authentication_attempt(
          attempt_save(expired, 2),
        ),
        { ok: true },
      );
      assertEquals(
        await repository.save_authentication_attempt(attempt_save(first, 2)),
        { ok: true },
      );
      assertEquals(
        await repository.save_authentication_attempt(attempt_save(second, 2)),
        { ok: true },
      );
      assertEquals(
        (
          await repository.find_by_credential_hash("credential-1")
        )?.authentication_attempts.map((attempt) => attempt.state_hash),
        ["first", "second"],
      );
      assertEquals(
        await repository.save_authentication_attempt(
          attempt_save(
            authentication_attempt("second", {
              created_at: at(4 * MINUTE_MS),
              expires_at: at(HOUR_MS),
            }),
            2,
          ),
        ),
        { ok: false, reason: "state_collision" },
      );
      assertEquals(
        await repository.save_authentication_attempt({
          ...attempt_save(authentication_attempt("stale")),
          expected_version: 2,
        }),
        { ok: false, reason: "stale_session" },
      );

      await repository.create(authenticated_record());
      assertEquals(
        await repository.save_authentication_attempt({
          ...attempt_save(authentication_attempt("authenticated")),
          session_id: "session-authenticated",
          expected_version: 2,
        }),
        { ok: false, reason: "not_guest" },
      );
    },
  );

  conformance_test(
    "concurrent distinct attempt saves retain every winner",
    async (repository) => {
      await repository.create(guest_record());
      const results = await Promise.all(
        ["one", "two", "three"].map((state_hash, index) =>
          repository.save_authentication_attempt(
            attempt_save(
              authentication_attempt(state_hash, {
                created_at: at((index + 1) * MINUTE_MS),
                expires_at: at(HOUR_MS),
              }),
            ),
          )
        ),
      );
      assertEquals(results, [{ ok: true }, { ok: true }, { ok: true }]);
      const stored = await repository.find_by_credential_hash("credential-1");
      assertEquals(
        stored?.authentication_attempts.map((attempt) => attempt.state_hash)
          .sort(),
        ["one", "three", "two"],
      );
    },
  );

  conformance_test(
    "attempt consumption matches strategy and state, prunes, and consumes once",
    async (repository) => {
      const expired = authentication_attempt("expired", {
        created_at: at(0),
        expires_at: at(MINUTE_MS),
      });
      const active = authentication_attempt("active", {
        created_at: at(0),
        expires_at: at(HOUR_MS),
      });
      await repository.create({
        ...guest_record(),
        authentication_attempts: [expired, active],
      });

      assertEquals(
        await repository.consume_authentication_attempt({
          session_id: "session-1",
          expected_version: 1,
          strategy_id: "other",
          state_hash: "active",
          consumed_at: at(2 * MINUTE_MS),
        }),
        { ok: false, reason: "not_found" },
      );
      assertEquals(
        (
          await repository.find_by_credential_hash("credential-1")
        )?.authentication_attempts.map((attempt) => attempt.state_hash),
        ["active"],
      );

      const consumed = await repository.consume_authentication_attempt({
        session_id: "session-1",
        expected_version: 1,
        strategy_id: "google",
        state_hash: "active",
        consumed_at: at(2 * MINUTE_MS),
      });
      assertEquals(consumed, { ok: true, attempt: active });
      assertEquals(
        await repository.consume_authentication_attempt({
          session_id: "session-1",
          expected_version: 1,
          strategy_id: "google",
          state_hash: "active",
          consumed_at: at(2 * MINUTE_MS),
        }),
        { ok: false, reason: "not_found" },
      );
    },
  );

  conformance_test(
    "concurrent attempt consumption has one winner",
    async (repository) => {
      await repository.create({
        ...guest_record(),
        authentication_attempts: [authentication_attempt("one-use")],
      });
      const input = {
        session_id: "session-1",
        expected_version: 1,
        strategy_id: "google",
        state_hash: "one-use",
        consumed_at: at(HOUR_MS + MINUTE_MS),
      } as const;

      const results = await Promise.all([
        repository.consume_authentication_attempt(input),
        repository.consume_authentication_attempt(input),
      ]);
      assertEquals(results.filter((result) => result.ok).length, 1);
      assertEquals(
        results.filter((result) => !result.ok && result.reason === "not_found")
          .length,
        1,
      );
    },
  );

  conformance_test(
    "upgrade rotates the credential and rejects collisions atomically",
    async (repository) => {
      await repository.create(guest_record());
      await repository.create(
        guest_record("collision-owner", "credential-collision"),
      );
      assertEquals(
        await repository.upgrade(upgrade_input("credential-collision")),
        { ok: false, reason: "credential_collision" },
      );
      assertExists(await repository.find_by_credential_hash("credential-1"));

      const upgraded = await repository.upgrade(
        upgrade_input("credential-rotated"),
      );
      assertEquals(upgraded.ok, true);
      if (!upgraded.ok) return;
      assertEquals(upgraded.record, {
        kind: "authenticated",
        session_id: "session-1",
        session_version: 2,
        user_id: "user-1",
        created_at: at(0),
        last_seen_at: at(2 * HOUR_MS),
        authenticated_at: at(2 * HOUR_MS),
        absolute_expires_at: at(90 * DAY_MS),
        idle_expires_at: at(30 * DAY_MS),
        csrf_token: "rotated-csrf-token",
        credential_hash: "credential-rotated",
        revoked_at: null,
        authentication_attempts: [],
      });
      assertEquals(
        await repository.find_by_credential_hash("credential-1"),
        null,
      );
      assertEquals(
        await repository.find_by_credential_hash("credential-rotated"),
        upgraded.record,
      );
      assertEquals(
        await repository.upgrade(upgrade_input("another-credential")),
        { ok: false, reason: "stale_session" },
      );

      const renewed = await repository.renew(
        "session-1",
        2,
        at(3 * HOUR_MS),
        at(40 * DAY_MS),
      );
      assertEquals(renewed?.kind, "authenticated");
      if (renewed?.kind !== "authenticated") return;
      assertEquals(renewed.idle_expires_at, at(40 * DAY_MS));
    },
  );

  conformance_test(
    "concurrent upgrades rotate one credential only",
    async (repository) => {
      await repository.create(guest_record());
      const results = await Promise.all([
        repository.upgrade(upgrade_input("credential-a")),
        repository.upgrade(upgrade_input("credential-b")),
      ]);
      assertEquals(results.filter((result) => result.ok).length, 1);
      assertEquals(
        results.filter((result) =>
          !result.ok && result.reason === "stale_session"
        ).length,
        1,
      );
      const winning_hash = results.find((result) => result.ok)?.record
        .credential_hash;
      assertExists(winning_hash);
      assertEquals(
        (await repository.find_by_credential_hash(winning_hash))?.session_id,
        "session-1",
      );
    },
  );

  conformance_test(
    "logout requires authentication, exact CSRF, and revokes the bearer",
    async (repository) => {
      await repository.create(guest_record());
      assertEquals(
        await repository.logout({
          session_id: "session-1",
          expected_version: 1,
          csrf_token: "csrf-token",
          logged_out_at: at(2 * HOUR_MS),
        }),
        { ok: false, reason: "not_authenticated" },
      );

      await repository.create(authenticated_record());
      const logout = {
        session_id: "session-authenticated",
        expected_version: 2,
        logged_out_at: at(2 * HOUR_MS),
      } as const;
      assertEquals(
        await repository.logout({ ...logout, csrf_token: "wrong-token" }),
        { ok: false, reason: "invalid_csrf" },
      );
      assertEquals(
        await repository.logout({ ...logout, csrf_token: "csrf-token" }),
        { ok: true },
      );
      assertEquals(
        await repository.find_by_credential_hash("credential-authenticated"),
        null,
      );
      assertEquals(
        await repository.logout({ ...logout, csrf_token: "csrf-token" }),
        { ok: false, reason: "stale_session" },
      );
    },
  );

  conformance_test(
    "concurrent logout has one winner",
    async (repository) => {
      await repository.create(authenticated_record());
      const input = {
        session_id: "session-authenticated",
        expected_version: 2,
        csrf_token: "csrf-token",
        logged_out_at: at(2 * HOUR_MS),
      } as const;
      const results = await Promise.all([
        repository.logout(input),
        repository.logout(input),
      ]);
      assertEquals(results.filter((result) => result.ok).length, 1);
      assertEquals(
        results.filter((result) =>
          !result.ok && result.reason === "stale_session"
        ).length,
        1,
      );
    },
  );

  conformance_test(
    "revocation is version-bound and has one concurrent winner",
    async (repository) => {
      await repository.create(guest_record());
      assertEquals(
        await repository.revoke("session-1", 2, at(HOUR_MS)),
        false,
      );
      const results = await Promise.all([
        repository.revoke("session-1", 1, at(HOUR_MS)),
        repository.revoke("session-1", 1, at(HOUR_MS)),
      ]);
      assertEquals(results.filter(Boolean).length, 1);
      assertEquals(
        await repository.find_by_credential_hash("credential-1"),
        null,
      );
      assertEquals(
        await repository.renew("session-1", 1, at(2 * HOUR_MS)),
        null,
      );
    },
  );
}
