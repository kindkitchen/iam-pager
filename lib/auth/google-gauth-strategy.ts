import { GAuth } from "@kindkitchen/gauth";
import { Effect } from "effect";
import type { AuthenticationStrategy } from "./interfaces.ts";
import type {
  AuthenticationBeginInput,
  AuthenticationCompleteInput,
  AuthenticationIdentity,
  AuthenticationStrategyResult,
} from "./model.ts";

export type GAuthService = (typeof GAuth.Interface)["Service"];

/** Thin provider adapter; preset selection and configuration stay at composition. */
export class GoogleGAuthStrategy implements AuthenticationStrategy {
  readonly strategy_id = "google";
  readonly #gauth: GAuthService;

  constructor(gauth: GAuthService) {
    this.#gauth = gauth;
  }

  async begin(
    input: AuthenticationBeginInput,
  ): Promise<
    AuthenticationStrategyResult<{
      authorization_url: string;
      attempt_context: string;
    }>
  > {
    try {
      const result = await Effect.runPromise(
        this.#gauth.generate_sign_in_url({
          scope: ["openid", "email", "profile"],
          state: input.state,
          redirect_uri: input.callback_url,
        }),
      );
      return {
        ok: true,
        value: {
          authorization_url: result.authorization_url,
          attempt_context: result.ctx.code_verifier,
        },
      };
    } catch {
      return { ok: false, reason: "provider_failure" };
    }
  }

  async complete(
    input: AuthenticationCompleteInput,
  ): Promise<AuthenticationStrategyResult<AuthenticationIdentity>> {
    if (input.attempt_context === undefined) {
      return { ok: false, reason: "provider_failure" };
    }

    try {
      const result = await Effect.runPromise(
        this.#gauth.process_callback_payload({
          code: input.code,
          code_verifier: input.attempt_context,
        }),
      );
      return {
        ok: true,
        value: {
          provider_subject: result.user_info.id,
          email: result.user_info.email,
          ...(result.user_info.name
            ? { display_name: result.user_info.name }
            : {}),
          ...(result.user_info.picture
            ? { picture_url: result.user_info.picture }
            : {}),
        },
      };
    } catch {
      // GAuthErr may retain a provider cause; never expose it across this bound.
      return { ok: false, reason: "provider_failure" };
    }
  }
}
