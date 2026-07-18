import {
  AuthenticationStrategyRegistry,
  type AuthenticationStrategyResolver,
  type IdentityRepository,
  MemoryIdentityRepository,
} from "./auth/mod.ts";
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
import {
  CookieSessionStrategy,
  CryptoCredentialGenerator,
  CryptoIdGenerator,
  MemorySessionRepository,
  session_cookie_config,
  type SessionCookieMode,
  type SessionManager,
  SessionService,
  type SessionTransport,
  SystemClock,
} from "./session/mod.ts";
import {
  type RequestContextHandler,
  RequestContextMiddleware,
} from "./request-context.ts";

/**
 * Namespaces reserved for site and platform routes (QT-ROUTING): `site` is
 * the SPA alias, while `api` and `auth` are platform surfaces. Route precedence
 * already keeps those paths off the catch-all; forbidding them here also
 * stops anyone from publishing pages that could never be delivered.
 */
export const forbidden_namespaces: readonly string[] = ["site", "api", "auth"];

/** Everything the web layer needs; routes stay thin adapters over this. */
export interface AppServices {
  engine: LocatorEngine;
  repository: ContentRepository;
  publishing: PagePublisher & PageDeliverer;
  session: SessionManager;
  session_transport: SessionTransport;
  request_context: RequestContextHandler;
  identity_repository: IdentityRepository;
  authentication_strategies: AuthenticationStrategyResolver;
}

export interface AppServiceOptions {
  /** Defaults secure; localhost must be selected deliberately. */
  readonly session_cookie_mode?: SessionCookieMode;
}

export const SESSION_COOKIE_MODE_ENV = "IAM_PAGER_SESSION_COOKIE_MODE";

export function parse_session_cookie_mode(
  value: string | undefined,
): SessionCookieMode {
  if (value === undefined || value === "production") return "production";
  if (value === "local") return "local";
  throw new TypeError(
    `${SESSION_COOKIE_MODE_ENV} must be local or production`,
  );
}

/** Composition root: one place that wires strategies, handlers, storage. */
export function create_app_services(
  options: AppServiceOptions = {},
): AppServices {
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
  const session_repository = new MemorySessionRepository();
  const session = new SessionService({
    repository: session_repository,
    clock: new SystemClock(),
    id_generator: new CryptoIdGenerator(),
    credential_generator: new CryptoCredentialGenerator(),
  });
  const session_transport = new CookieSessionStrategy(
    session_cookie_config(options.session_cookie_mode ?? "production"),
  );
  const request_context = new RequestContextMiddleware({
    session_resolver: session,
    session_transport,
    request_id_generator: new CryptoIdGenerator(),
  });
  const identity_repository = new MemoryIdentityRepository(
    new CryptoIdGenerator(),
  );
  const authentication_strategies = new AuthenticationStrategyRegistry([]);
  return {
    engine,
    repository,
    publishing,
    session,
    session_transport,
    request_context,
    identity_repository,
    authentication_strategies,
  };
}

let services: AppServices | undefined;

/** Process-wide services shared by all HTTP routes. */
export function app_services(): AppServices {
  services ??= create_app_services({
    session_cookie_mode: parse_session_cookie_mode(
      Deno.env.get(SESSION_COOKIE_MODE_ENV),
    ),
  });
  return services;
}
