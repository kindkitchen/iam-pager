import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import type {
  Clock,
  CredentialGenerator,
  IdGenerator,
} from "../session/interfaces.ts";
import { MemorySessionRepository } from "../session/memory-repository.ts";
import { SessionService } from "../session/service.ts";
import type {
  AuthenticationStateGenerator,
  AuthenticationStrategy,
  UserIdGenerator,
} from "./interfaces.ts";
import { MemoryIdentityRepository } from "./memory-identity-repository.ts";
import { normalize_authentication_return_to } from "./model.ts";
import { AuthenticationService } from "./service.ts";
import { AuthenticationStrategyRegistry } from "./strategy-registry.ts";

class FakeClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
}

class SequenceGenerator
  implements
    IdGenerator,
    CredentialGenerator,
    AuthenticationStateGenerator,
    UserIdGenerator {
  constructor(private readonly values: string[]) {}

  generate(): string {
    const value = this.values.shift();
    if (value === undefined) throw new Error("sequence exhausted");
    return value;
  }
}

class FakeStrategy implements AuthenticationStrategy {
  readonly begin_inputs: Array<{ state: string; callback_url: string }> = [];
  readonly complete_inputs: Array<{
    code: string;
    callback_url: string;
    attempt_context?: string;
  }> = [];
  fail_begin = false;
  fail_complete = false;

  constructor(readonly strategy_id: string) {}

  begin(input: { state: string; callback_url: string }) {
    this.begin_inputs.push(input);
    if (this.fail_begin) {
      return Promise.resolve({
        ok: false as const,
        reason: "provider_failure" as const,
      });
    }
    return Promise.resolve({
      ok: true as const,
      value: {
        authorization_url:
          `https://${this.strategy_id}.example/authorize?state=${input.state}`,
        attempt_context: `context-${input.state}`,
      },
    });
  }

  complete(
    input: { code: string; callback_url: string; attempt_context?: string },
  ) {
    this.complete_inputs.push(input);
    if (this.fail_complete) {
      return Promise.resolve({
        ok: false as const,
        reason: "provider_failure" as const,
      });
    }
    return Promise.resolve({
      ok: true as const,
      value: {
        provider_subject: `${this.strategy_id}-subject`,
        email: `${this.strategy_id}@example.com`,
        display_name: `${this.strategy_id} person`,
      },
    });
  }
}

function token(character: string): string {
  return character.repeat(43);
}

function make_fixture() {
  const clock = new FakeClock(new Date("2026-07-18T12:00:00.000Z"));
  const session_repository = new MemorySessionRepository();
  const sessions = new SessionService({
    repository: session_repository,
    clock,
    id_generator: new SequenceGenerator([
      "session-1",
      "session-2",
      "session-3",
    ]),
    credential_generator: new SequenceGenerator([
      token("A"),
      token("B"),
      token("C"),
      token("D"),
    ]),
  });
  const google = new FakeStrategy("google");
  const other = new FakeStrategy("other");
  const identities = new MemoryIdentityRepository(
    new SequenceGenerator(["user-1", "user-2"]),
  );
  const authentication = new AuthenticationService({
    strategies: new AuthenticationStrategyRegistry([google, other]),
    sessions,
    identities,
    state_generator: new SequenceGenerator([
      token("s"),
      token("t"),
      token("u"),
      token("v"),
    ]),
    clock,
  });
  return {
    authentication,
    clock,
    google,
    identities,
    other,
    sessions,
  };
}

Deno.test("authentication start selects a strategy and saves its server context", async () => {
  const { authentication, google, other, sessions } = make_fixture();
  const guest = await sessions.resolve();

  const started = await authentication.start({
    session: guest.session,
    strategy_id: "google",
    callback_url: "https://app.example/auth/google/callback",
    return_to: "/site/account?tab=security",
  });

  assertEquals(started, {
    ok: true,
    value: {
      authorization_url: `https://google.example/authorize?state=${token("s")}`,
    },
  });
  assertEquals(google.begin_inputs, [{
    state: token("s"),
    callback_url: "https://app.example/auth/google/callback",
  }]);
  assertEquals(other.begin_inputs, []);

  const consumed = await sessions.consume_authentication_attempt(
    guest.session,
    "google",
    token("s"),
  );
  assertEquals(consumed.ok, true);
  if (!consumed.ok) return;
  assertEquals(consumed.attempt.return_to, "/site/account?tab=security");
  assertEquals(consumed.attempt.attempt_context, `context-${token("s")}`);
});

Deno.test("authentication callback consumes state, saves identity, and rotates session", async () => {
  const { authentication, google, identities, sessions } = make_fixture();
  const guest = await sessions.resolve();
  assertExists(guest.credential_to_set);
  const old_credential = guest.credential_to_set.value;
  await authentication.start({
    session: guest.session,
    strategy_id: "google",
    callback_url: "https://app.example/auth/google/callback",
    return_to: "/site/account",
  });

  const completed = await authentication.complete({
    session: guest.session,
    strategy_id: "google",
    code: "provider-code",
    state: token("s"),
  });

  assertEquals(completed.ok, true);
  if (!completed.ok) return;
  assertEquals(completed.value.return_to, "/site/account");
  assertEquals(completed.value.identity.user.user_id, "user-1");
  assertEquals(
    completed.value.identity.identity.provider_subject,
    "google-subject",
  );
  assertEquals(
    completed.value.session_resolution.session.kind,
    "authenticated",
  );
  assertEquals(
    completed.value.session_resolution.session.session_id,
    guest.session.session_id,
  );
  assertExists(completed.value.session_resolution.credential_to_set);
  assertNotEquals(
    completed.value.session_resolution.credential_to_set.value,
    old_credential,
  );
  assertEquals(identities.user_count, 1);
  assertEquals(google.complete_inputs, [{
    code: "provider-code",
    callback_url: "https://app.example/auth/google/callback",
    attempt_context: `context-${token("s")}`,
  }]);

  const replacement_guest = await sessions.resolve(old_credential);
  assertEquals(replacement_guest.session.kind, "guest");
  assertNotEquals(
    replacement_guest.session.session_id,
    guest.session.session_id,
  );
  assertEquals(
    await authentication.complete({
      session: replacement_guest.session,
      strategy_id: "google",
      code: "provider-code",
      state: token("s"),
    }),
    { ok: false, reason: "invalid_attempt" },
  );
});

Deno.test("provider callback failure burns the attempt and leaves the guest", async () => {
  const { authentication, google, identities, sessions } = make_fixture();
  const guest = await sessions.resolve();
  google.fail_complete = true;
  await authentication.start({
    session: guest.session,
    strategy_id: "google",
    callback_url: "https://app.example/auth/google/callback",
  });

  assertEquals(
    await authentication.complete({
      session: guest.session,
      strategy_id: "google",
      code: "bad-code",
      state: token("s"),
    }),
    { ok: false, reason: "provider_failure" },
  );
  assertEquals(
    await authentication.complete({
      session: guest.session,
      strategy_id: "google",
      code: "bad-code",
      state: token("s"),
    }),
    { ok: false, reason: "invalid_attempt" },
  );
  assertEquals(identities.user_count, 0);
  assertEquals(guest.session.kind, "guest");
});

Deno.test("authentication rejects unknown strategies and unsafe local returns", async () => {
  const { authentication, sessions } = make_fixture();
  const guest = await sessions.resolve();

  assertEquals(
    await authentication.start({
      session: guest.session,
      strategy_id: "missing",
      callback_url: "https://app.example/auth/missing/callback",
    }),
    { ok: false, reason: "unknown_strategy" },
  );
  for (
    const return_to of [
      "https://evil.example",
      "//evil.example/path",
      "/%2f%2fevil.example/path",
      "/%255c%255cevil.example/path",
    ]
  ) {
    assertEquals(
      await authentication.start({
        session: guest.session,
        strategy_id: "google",
        callback_url: "https://app.example/auth/google/callback",
        return_to,
      }),
      { ok: false, reason: "invalid_return_to" },
    );
  }

  assertEquals(normalize_authentication_return_to(undefined), "/");
  assertEquals(
    normalize_authentication_return_to("/site?tab=1#profile"),
    "/site?tab=1#profile",
  );
});
