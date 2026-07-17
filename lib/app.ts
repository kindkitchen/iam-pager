import { LocatorEngine, PathSlugStrategy } from "./locator/mod.ts";
import {
  type ContentRepository,
  MdPageHandler,
  MemoryContentRepository,
} from "./content/mod.ts";
import {
  type PageDeliverer,
  type PagePublisher,
  PublishingService,
} from "./publishing/mod.ts";

/**
 * Namespaces reserved for the site and platform routes (QT-ROUTING): `site`
 * is the SPA alias, `api` is the management/API surface. Route precedence
 * already keeps those paths off the catch-all; forbidding them here also
 * stops anyone from publishing pages that could never be delivered.
 */
export const forbidden_namespaces: readonly string[] = ["site", "api"];

/** Everything the web layer needs; routes stay thin adapters over this. */
export interface AppServices {
  engine: LocatorEngine;
  repository: ContentRepository;
  publishing: PagePublisher & PageDeliverer;
}

/** Composition root: one place that wires strategies, handlers, storage. */
export function create_app_services(): AppServices {
  const engine = new LocatorEngine({
    strategies: [new PathSlugStrategy()],
    forbidden_namespaces,
  });
  const repository = new MemoryContentRepository();
  const publishing = new PublishingService({
    engine,
    repository,
    handlers: [new MdPageHandler()],
  });
  return { engine, repository, publishing };
}

let services: AppServices | undefined;

/** Process-wide services shared by all HTTP routes. */
export function app_services(): AppServices {
  services ??= create_app_services();
  return services;
}
