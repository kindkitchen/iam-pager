import type {
  AuthenticationStrategy,
  AuthenticationStrategyResolver,
} from "./interfaces.ts";
import { is_authentication_strategy_id } from "./model.ts";

/** Default immutable-at-composition registry for provider adapters. */
export class AuthenticationStrategyRegistry
  implements AuthenticationStrategyResolver {
  #strategies = new Map<string, AuthenticationStrategy>();

  constructor(strategies: readonly AuthenticationStrategy[]) {
    for (const strategy of strategies) {
      if (!is_authentication_strategy_id(strategy.strategy_id)) {
        throw new TypeError(
          `invalid authentication strategy ID: ${strategy.strategy_id}`,
        );
      }
      if (this.#strategies.has(strategy.strategy_id)) {
        throw new Error(
          `duplicate authentication strategy: ${strategy.strategy_id}`,
        );
      }
      this.#strategies.set(strategy.strategy_id, strategy);
    }
  }

  resolve(strategy_id: string): AuthenticationStrategy | null {
    return this.#strategies.get(strategy_id) ?? null;
  }
}
