import { assertEquals } from "@std/assert";
import { GAuth } from "@kindkitchen/gauth";
import { Effect } from "effect";
import type { GAuthService } from "./google-gauth-strategy.ts";
import { GoogleGAuthStrategy } from "./google-gauth-strategy.ts";

function fake_gauth_service() {
  const begin_inputs: Parameters<GAuthService["generate_sign_in_url"]>[0][] =
    [];
  const callback_inputs: Parameters<
    GAuthService["process_callback_payload"]
  >[0][] = [];
  const service: GAuthService = {
    generate_sign_in_url: (input) => {
      begin_inputs.push(input);
      return Effect.succeed({
        authorization_url: "https://accounts.example/authorize",
        ctx: { code_verifier: "server-only-verifier" },
      });
    },
    process_callback_payload: (input) => {
      callback_inputs.push(input);
      return Effect.succeed({
        access_token: "discarded-access-token",
        id_token: "discarded-id-token",
        refresh_token: "discarded-refresh-token",
        user_info: {
          id: "google-subject-1",
          email: "person@example.com",
          name: "Example Person",
          picture: "https://images.example/person.png",
        },
      });
    },
  };
  return { begin_inputs, callback_inputs, service };
}

Deno.test("Google gauth strategy passes exact authorization inputs and keeps verifier as context", async () => {
  const fake = fake_gauth_service();
  const strategy = new GoogleGAuthStrategy(fake.service);

  const result = await strategy.begin({
    state: "application-owned-state",
    callback_url: "https://app.example/auth/google/callback",
  });

  assertEquals(result, {
    ok: true,
    value: {
      authorization_url: "https://accounts.example/authorize",
      attempt_context: "server-only-verifier",
    },
  });
  assertEquals(fake.begin_inputs, [{
    scope: ["openid", "email", "profile"],
    state: "application-owned-state",
    redirect_uri: "https://app.example/auth/google/callback",
  }]);
});

Deno.test("Google gauth strategy maps verified identity and discards provider tokens", async () => {
  const fake = fake_gauth_service();
  const strategy = new GoogleGAuthStrategy(fake.service);

  const result = await strategy.complete({
    code: "provider-code",
    callback_url: "https://app.example/auth/google/callback",
    attempt_context: "server-only-verifier",
  });

  assertEquals(fake.callback_inputs, [{
    code: "provider-code",
    code_verifier: "server-only-verifier",
  }]);
  assertEquals(result, {
    ok: true,
    value: {
      provider_subject: "google-subject-1",
      email: "person@example.com",
      display_name: "Example Person",
      picture_url: "https://images.example/person.png",
    },
  });
  assertEquals(JSON.stringify(result).includes("discarded"), false);
});

Deno.test("Google gauth strategy resolves the same callback-specific service for start and exchange", async () => {
  const fake = fake_gauth_service();
  const callback_urls: string[] = [];
  const strategy = new GoogleGAuthStrategy(fake.service, {
    resolve(callback_url) {
      callback_urls.push(callback_url);
      return Promise.resolve(fake.service);
    },
  });
  const callback_url = "https://preview-change-42.example/auth/google/callback";

  await strategy.begin({ state: "state", callback_url });
  await strategy.complete({
    code: "provider-code",
    callback_url,
    attempt_context: "server-only-verifier",
  });

  assertEquals(callback_urls, [callback_url, callback_url]);
});

Deno.test("Google gauth strategy maps provider errors without exposing causes", async () => {
  const secret_cause = new Error("provider response with secret details");
  const service: GAuthService = {
    generate_sign_in_url: () => Effect.fail(secret_cause),
    process_callback_payload: () =>
      Effect.fail(
        new GAuth.Errors.GAuthErr({
          message: "token exchange failed",
          cause: secret_cause,
        }),
      ),
  };
  const strategy = new GoogleGAuthStrategy(service);

  assertEquals(
    await strategy.begin({
      state: "state",
      callback_url: "https://app.example/auth/google/callback",
    }),
    { ok: false, reason: "provider_failure" },
  );
  const completed = await strategy.complete({
    code: "bad-code",
    callback_url: "https://app.example/auth/google/callback",
    attempt_context: "verifier",
  });
  assertEquals(completed, { ok: false, reason: "provider_failure" });
  assertEquals(JSON.stringify(completed).includes("secret"), false);
});

Deno.test("Google gauth strategy fails closed without server-side verifier", async () => {
  const fake = fake_gauth_service();
  const strategy = new GoogleGAuthStrategy(fake.service);

  assertEquals(
    await strategy.complete({
      code: "provider-code",
      callback_url: "https://app.example/auth/google/callback",
    }),
    { ok: false, reason: "provider_failure" },
  );
  assertEquals(fake.callback_inputs, []);
});
