import type { Locator, LocatorResolution } from "./model.ts";

/**
 * A resolution strategy is a pure bidirectional mapping between public
 * request pathnames and locators. Any implementation satisfying this
 * interface plugs into the engine without further wiring.
 *
 * Strategies only map; policy (forbidden namespaces, strategy selection)
 * lives in the engine.
 */
export interface LocatorStrategy {
  readonly strategy_name: string;
  /** Map an incoming request pathname to a locator. */
  resolve(pathname: string): LocatorResolution;
  /** Build the public pathname for a locator under this strategy. */
  format(locator: Locator): string;
}
