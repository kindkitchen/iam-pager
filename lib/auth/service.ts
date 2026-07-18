import type { Clock, SessionManager } from "../session/interfaces.ts";
import type {
  AuthenticationOrchestrator,
  AuthenticationStateGenerator,
  AuthenticationStrategyResolver,
  IdentityRepository,
} from "./interfaces.ts";
import {
  type AuthenticationBeginOutput,
  type AuthenticationCallbackRequest,
  type AuthenticationCallbackResult,
  type AuthenticationIdentity,
  type AuthenticationStartRequest,
  type AuthenticationStartResult,
  normalize_authentication_return_to,
} from "./model.ts";

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_STATE_GENERATION_ATTEMPTS = 8;
const MAX_AUTHORIZATION_URL_LENGTH = 8192;
const MAX_CALLBACK_CODE_LENGTH = 4096;
const MAX_ATTEMPT_CONTEXT_LENGTH = 4096;

export interface AuthenticationServiceOptions {
  readonly strategies: AuthenticationStrategyResolver;
  readonly sessions: SessionManager;
  readonly identities: IdentityRepository;
  readonly state_generator: AuthenticationStateGenerator;
  readonly clock: Clock;
}

/** Owns provider-neutral start/callback authentication orchestration. */
export class AuthenticationService implements AuthenticationOrchestrator {
  readonly #strategies: AuthenticationStrategyResolver;
  readonly #sessions: SessionManager;
  readonly #identities: IdentityRepository;
  readonly #state_generator: AuthenticationStateGenerator;
  readonly #clock: Clock;

  constructor(options: AuthenticationServiceOptions) {
    this.#strategies = options.strategies;
    this.#sessions = options.sessions;
    this.#identities = options.identities;
    this.#state_generator = options.state_generator;
    this.#clock = options.clock;
  }

  async start(
    input: AuthenticationStartRequest,
  ): Promise<AuthenticationStartResult> {
    const strategy = this.#strategies.resolve(input.strategy_id);
    if (strategy === null) return { ok: false, reason: "unknown_strategy" };
    if (input.session.kind !== "guest") {
      return { ok: false, reason: "not_guest" };
    }

    const return_to = normalize_authentication_return_to(input.return_to);
    if (return_to === null) {
      return { ok: false, reason: "invalid_return_to" };
    }
    if (!is_valid_callback_url(input.callback_url)) {
      return { ok: false, reason: "invalid_callback_url" };
    }

    for (let attempt = 0; attempt < MAX_STATE_GENERATION_ATTEMPTS; attempt++) {
      const state = this.#state_generator.generate();
      if (!STATE_PATTERN.test(state)) {
        throw new Error(
          "authentication state generator must return 256-bit base64url",
        );
      }

      const begin_result = await strategy.begin({
        state,
        callback_url: input.callback_url,
      });
      if (!begin_result.ok || !is_valid_begin_output(begin_result.value)) {
        return { ok: false, reason: "provider_failure" };
      }

      const save_result = await this.#sessions.save_authentication_attempt(
        input.session,
        {
          strategy_id: strategy.strategy_id,
          state,
          callback_url: input.callback_url,
          return_to,
          attempt_context: begin_result.value.attempt_context,
        },
      );
      if (save_result.ok) {
        return {
          ok: true,
          value: { authorization_url: begin_result.value.authorization_url },
        };
      }
      if (save_result.reason === "state_collision") continue;
      return { ok: false, reason: save_result.reason };
    }

    throw new Error("could not allocate a unique authentication state");
  }

  async complete(
    input: AuthenticationCallbackRequest,
  ): Promise<AuthenticationCallbackResult> {
    const strategy = this.#strategies.resolve(input.strategy_id);
    if (strategy === null) return { ok: false, reason: "unknown_strategy" };
    if (input.session.kind !== "guest") {
      return { ok: false, reason: "not_guest" };
    }

    // Consume first: malformed codes, provider failures, and callback replays
    // must never get another exchange attempt for the same state.
    const consumed = await this.#sessions.consume_authentication_attempt(
      input.session,
      strategy.strategy_id,
      input.state,
    );
    if (!consumed.ok) return consumed;
    if (
      input.code.length === 0 || input.code.length > MAX_CALLBACK_CODE_LENGTH
    ) {
      return { ok: false, reason: "invalid_callback" };
    }

    const complete_result = await strategy.complete({
      code: input.code,
      callback_url: consumed.attempt.callback_url,
      attempt_context: consumed.attempt.attempt_context,
    });
    if (
      !complete_result.ok ||
      !is_valid_authentication_identity(complete_result.value)
    ) {
      return { ok: false, reason: "provider_failure" };
    }

    const identity = await this.#identities.find_or_create({
      strategy_id: strategy.strategy_id,
      provider_subject: complete_result.value.provider_subject,
      email: complete_result.value.email,
      display_name: complete_result.value.display_name,
      picture_url: complete_result.value.picture_url,
      observed_at: this.#clock.now(),
    });
    const upgraded = await this.#sessions.upgrade(
      input.session,
      identity.user.user_id,
    );
    if (!upgraded.ok) return upgraded;

    return {
      ok: true,
      value: {
        identity,
        session_resolution: upgraded.resolution,
        return_to: consumed.attempt.return_to,
      },
    };
  }
}

function is_valid_callback_url(value: string): boolean {
  if (value.length === 0 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.username.length === 0 && url.password.length === 0 &&
      url.hash.length === 0;
  } catch {
    return false;
  }
}

function is_valid_begin_output(
  output: AuthenticationBeginOutput,
): boolean {
  if (
    output.authorization_url.length === 0 ||
    output.authorization_url.length > MAX_AUTHORIZATION_URL_LENGTH ||
    (output.attempt_context?.length ?? 0) > MAX_ATTEMPT_CONTEXT_LENGTH
  ) {
    return false;
  }
  try {
    const url = new URL(output.authorization_url);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function is_valid_authentication_identity(
  identity: AuthenticationIdentity,
): boolean {
  return identity.provider_subject.length > 0 &&
    identity.provider_subject.length <= 1024 &&
    identity.email.length > 0 && identity.email.length <= 320 &&
    (identity.display_name?.length ?? 0) <= 1024 &&
    (identity.picture_url?.length ?? 0) <= 2048;
}
