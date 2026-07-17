import type { Locator, LocatorResolution } from "./model.ts";
import type { LocatorStrategy } from "./strategy.ts";

export interface LocatorEngineOptions {
  strategies: readonly LocatorStrategy[];
  /** Strategy used when none is named. Defaults to the first strategy. */
  default_strategy?: string;
  /** Namespaces reserved for the site/platform; matched case-insensitively. */
  forbidden_namespaces?: Iterable<string>;
}

/**
 * Holds the registered strategies and applies locator policy on top of the
 * pure strategy mappings: forbidden-namespace checks apply to every strategy
 * so a new strategy cannot accidentally re-allow a reserved namespace.
 */
export class LocatorEngine {
  #strategies = new Map<string, LocatorStrategy>();
  #default_strategy: string;
  #forbidden_namespaces: Set<string>;

  constructor(options: LocatorEngineOptions) {
    if (options.strategies.length === 0) {
      throw new Error("LocatorEngine requires at least one strategy");
    }
    for (const strategy of options.strategies) {
      if (this.#strategies.has(strategy.strategy_name)) {
        throw new Error(`duplicate strategy: ${strategy.strategy_name}`);
      }
      this.#strategies.set(strategy.strategy_name, strategy);
    }
    this.#default_strategy = options.default_strategy ??
      options.strategies[0].strategy_name;
    if (!this.#strategies.has(this.#default_strategy)) {
      throw new Error(`unknown default strategy: ${this.#default_strategy}`);
    }
    this.#forbidden_namespaces = new Set(
      [...options.forbidden_namespaces ?? []].map((ns) => ns.toLowerCase()),
    );
  }

  /** Resolve a pathname via a strategy, then apply namespace policy. */
  resolve(pathname: string, strategy_name?: string): LocatorResolution {
    const resolution = this.#strategy(strategy_name).resolve(pathname);
    if (!resolution.ok) return resolution;
    if (this.is_forbidden(resolution.locator.namespace)) {
      return { ok: false, reason: "forbidden_namespace" };
    }
    return resolution;
  }

  /**
   * Verify that a locator survives the selected public mapping unchanged.
   * This keeps malformed or ambiguous locators out of storage rather than
   * producing pages that no request path can retrieve.
   */
  validate(locator: Locator, strategy_name?: string): LocatorResolution {
    const strategy = this.#strategy(strategy_name);
    const resolution = strategy.resolve(strategy.format(locator));
    if (!resolution.ok) return resolution;
    if (!same_locator(resolution.locator, locator)) {
      return { ok: false, reason: "invalid_segment" };
    }
    if (this.is_forbidden(locator.namespace)) {
      return { ok: false, reason: "forbidden_namespace" };
    }
    return resolution;
  }

  /** Build the public pathname for a locator. Throws on forbidden namespace. */
  format(locator: Locator, strategy_name?: string): string {
    if (this.is_forbidden(locator.namespace)) {
      throw new Error(`forbidden namespace: ${locator.namespace}`);
    }
    return this.#strategy(strategy_name).format(locator);
  }

  is_forbidden(namespace: string): boolean {
    return this.#forbidden_namespaces.has(namespace.toLowerCase());
  }

  #strategy(name?: string): LocatorStrategy {
    const strategy_name = name ?? this.#default_strategy;
    const strategy = this.#strategies.get(strategy_name);
    if (!strategy) {
      throw new Error(`unknown strategy: ${strategy_name}`);
    }
    return strategy;
  }
}

function same_locator(left: Locator, right: Locator): boolean {
  return left.namespace === right.namespace &&
    left.page_name === right.page_name;
}
