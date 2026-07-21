import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import type { AuthenticationStrategy } from "./interfaces.ts";
import { AuthenticationStrategyRegistry } from "./strategy-registry.ts";

function fake_strategy(strategy_id: string): AuthenticationStrategy {
  return {
    strategy_id,
    begin: (input) =>
      Promise.resolve({
        ok: true,
        value: {
          authorization_url:
            `https://${strategy_id}.example/authorize?state=${input.state}`,
          attempt_context: `${strategy_id}-context`,
        },
      }),
    complete: () =>
      Promise.resolve({
        ok: true,
        value: {
          provider_subject: `${strategy_id}-subject`,
          email: `${strategy_id}@example.com`,
        },
      }),
  };
}

Deno.test("registry selects multiple authentication strategies independently", async () => {
  const first = fake_strategy("first");
  const second = fake_strategy("second");
  const registry = new AuthenticationStrategyRegistry([first, second]);

  assertStrictEquals(registry.resolve("first"), first);
  assertStrictEquals(registry.resolve("second"), second);

  const first_start = await registry.resolve("first")?.begin({
    state: "state-1",
    callback_url: "https://app.example/auth/first/callback",
  });
  const second_start = await registry.resolve("second")?.begin({
    state: "state-2",
    callback_url: "https://app.example/auth/second/callback",
  });
  assertEquals(
    first_start?.ok && first_start.value.authorization_url,
    "https://first.example/authorize?state=state-1",
  );
  assertEquals(
    second_start?.ok && second_start.value.authorization_url,
    "https://second.example/authorize?state=state-2",
  );
});

Deno.test("registry returns null for an unknown authentication strategy", () => {
  const registry = new AuthenticationStrategyRegistry([
    fake_strategy("known"),
  ]);

  assertEquals(registry.resolve("unknown"), null);
});

Deno.test("registry rejects duplicate and non-route-safe strategy IDs", () => {
  assertThrows(
    () =>
      new AuthenticationStrategyRegistry([
        fake_strategy("google"),
        fake_strategy("google"),
      ]),
    Error,
    "duplicate authentication strategy",
  );
  for (const strategy_id of ["", "Google", "google_oauth", "1-google"]) {
    assertThrows(
      () => new AuthenticationStrategyRegistry([fake_strategy(strategy_id)]),
      TypeError,
      "invalid authentication strategy ID",
    );
  }
});
