import {
  type AuthenticationCallbackUrlResolver,
  AuthenticationHttpAdapter,
  type AuthenticationHttpHandler,
  type AuthenticationOrchestrator,
  AuthenticationService,
  type AuthenticationStrategy,
  AuthenticationStrategyRegistry,
  type AuthenticationStrategyResolver,
  compose_google_gauth,
  ConfiguredAuthenticationCallbackUrlResolver,
  ConsoleAuthenticationHttpLogger,
  type EnvironmentSource,
  GoogleGAuthStrategy,
  GoogleMockConsentHttpAdapter,
  type GoogleMockConsentHttpHandler,
  type GoogleMockConsentScreen,
  type IdentityRepository,
  MemoryIdentityRepository,
  parse_google_auth_config,
  SiteAuthenticationCallbackFailurePresenter,
} from "./auth/mod.ts";
import { LocatorEngine, PathSlugStrategy } from "./locator/mod.ts";
import {
  type ContentRepository,
  MdPageHandler,
  MemoryContentRepository,
} from "./content/mod.ts";
import {
  NamespacePublishingAuthorizer,
  type PageDeliverer,
  type PagePublisher,
  PublishingService,
} from "./publishing/mod.ts";
import {
  MemoryNamespaceRepository,
  type NamespaceRepository,
  type NamespaceReservationManager,
  NamespaceReservationService,
} from "./namespace/mod.ts";
import {
  CookieSessionStrategy,
  CryptoCredentialGenerator,
  CryptoIdGenerator,
  MemorySessionRepository,
  session_cookie_config,
  type SessionCookieMode,
  type SessionManager,
  type SessionRepository,
  SessionService,
  type SessionTransport,
  SystemClock,
} from "./session/mod.ts";
import {
  type RequestContextHandler,
  RequestContextMiddleware,
} from "./request-context.ts";
import {
  DefaultOwnershipRepositoryFactory,
  DefaultSessionRepositoryFactory,
  type OwnershipRepositories,
  type OwnershipRepositoryFactory,
  parse_ownership_storage_config,
  parse_session_storage_config,
  type SessionRepositoryFactory,
} from "./storage/mod.ts";

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
  namespace_repository: NamespaceRepository;
  namespaces: NamespaceReservationManager;
  publishing: PagePublisher & PageDeliverer;
  session: SessionManager;
  session_transport: SessionTransport;
  request_context: RequestContextHandler;
  identity_repository: IdentityRepository;
  authentication_strategies: AuthenticationStrategyResolver;
  authentication: AuthenticationOrchestrator;
  authentication_http: AuthenticationHttpHandler;
  google_mock_consent_http: GoogleMockConsentHttpHandler;
}

export interface AppServiceOptions {
  /** Defaults secure; localhost must be selected deliberately. */
  readonly session_cookie_mode?: SessionCookieMode;
  /** Referentially linked repositories are supplied as one composition unit. */
  readonly ownership_repositories?: OwnershipRepositories;
  /** Session persistence remains independent from its HTTP transport. */
  readonly session_repository?: SessionRepository;
  /** Provider implementations are supplied at the composition boundary. */
  readonly authentication_strategies?: readonly AuthenticationStrategy[];
  /** Selects static or explicitly allowlisted request-derived callbacks. */
  readonly authentication_callback_url_resolver?:
    AuthenticationCallbackUrlResolver;
  /** Present only with the loopback-only local Google preset. */
  readonly google_mock_consent_screen?: GoogleMockConsentScreen;
}

export interface ConfiguredAppServiceOptions {
  /** Override only at an outer composition or test boundary. */
  readonly ownership_repository_factory?: OwnershipRepositoryFactory;
  /** Override only at an outer composition or test boundary. */
  readonly session_repository_factory?: SessionRepositoryFactory;
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
  const ownership_repositories = options.ownership_repositories ?? {
    identity_repository: new MemoryIdentityRepository(new CryptoIdGenerator()),
    namespace_repository: new MemoryNamespaceRepository(),
  };
  const namespace_repository = ownership_repositories.namespace_repository;
  const namespaces = new NamespaceReservationService({
    engine,
    repository: namespace_repository,
  });
  const publishing = new PublishingService({
    engine,
    repository,
    handlers: [new MdPageHandler()],
    authorizer: new NamespacePublishingAuthorizer(namespace_repository),
  });
  const clock = new SystemClock();
  const session_repository = options.session_repository ??
    new MemorySessionRepository();
  const session = new SessionService({
    repository: session_repository,
    clock,
    id_generator: new CryptoIdGenerator(),
    credential_generator: new CryptoCredentialGenerator(),
    csrf_token_generator: new CryptoCredentialGenerator(),
  });
  const session_transport = new CookieSessionStrategy(
    session_cookie_config(options.session_cookie_mode ?? "production"),
  );
  const request_context = new RequestContextMiddleware({
    session_resolver: session,
    session_transport,
    request_id_generator: new CryptoIdGenerator(),
  });
  const identity_repository = ownership_repositories.identity_repository;
  const authentication_strategies = new AuthenticationStrategyRegistry(
    options.authentication_strategies ?? [],
  );
  const authentication = new AuthenticationService({
    strategies: authentication_strategies,
    sessions: session,
    identities: identity_repository,
    state_generator: new CryptoCredentialGenerator(),
    clock,
  });
  const authentication_http = new AuthenticationHttpAdapter({
    authentication,
    sessions: session,
    logger: new ConsoleAuthenticationHttpLogger(),
    callback_failure_presenter:
      new SiteAuthenticationCallbackFailurePresenter(),
    callback_url_resolver: options.authentication_callback_url_resolver,
  });
  const google_mock_consent_http = new GoogleMockConsentHttpAdapter({
    screen: options.google_mock_consent_screen ?? null,
  });
  return {
    engine,
    repository,
    namespace_repository,
    namespaces,
    publishing,
    session,
    session_transport,
    request_context,
    identity_repository,
    authentication_strategies,
    authentication,
    authentication_http,
    google_mock_consent_http,
  };
}

/** Validates environment configuration, composes integrations, and registers Google. */
export async function create_configured_app_services(
  environment: EnvironmentSource,
  options: ConfiguredAppServiceOptions = {},
): Promise<AppServices> {
  const ownership_storage_config = parse_ownership_storage_config(environment);
  const session_storage_config = parse_session_storage_config(
    environment,
    ownership_storage_config,
  );
  const google_auth_config = parse_google_auth_config(environment);
  const google_gauth = await compose_google_gauth(google_auth_config);
  const ownership_repositories = await (
    options.ownership_repository_factory ??
      new DefaultOwnershipRepositoryFactory()
  ).create(ownership_storage_config, {
    user_id_generator: new CryptoIdGenerator(),
  });
  const session_repository = await (
    options.session_repository_factory ?? new DefaultSessionRepositoryFactory()
  ).create(session_storage_config);
  return create_app_services({
    ownership_repositories,
    session_repository,
    session_cookie_mode: parse_session_cookie_mode(
      environment.get(SESSION_COOKIE_MODE_ENV),
    ),
    authentication_strategies: [
      new GoogleGAuthStrategy(
        google_gauth.service,
        google_gauth.service_resolver,
      ),
    ],
    authentication_callback_url_resolver:
      new ConfiguredAuthenticationCallbackUrlResolver({
        ...(google_auth_config.redirect_uri === undefined
          ? {}
          : { configured_callback_url: google_auth_config.redirect_uri }),
        ...(google_auth_config.request_host_pattern === undefined
          ? {}
          : { request_host_pattern: google_auth_config.request_host_pattern }),
      }),
    ...(google_gauth.mock_consent_screen === null
      ? {}
      : { google_mock_consent_screen: google_gauth.mock_consent_screen }),
  });
}

let services: Promise<AppServices> | undefined;

/** Process-wide services shared by all HTTP routes. */
export function app_services(): Promise<AppServices> {
  services ??= create_configured_app_services(Deno.env);
  return services;
}
