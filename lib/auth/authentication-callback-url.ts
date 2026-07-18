const MAX_REQUEST_HOST_LENGTH = 261;

/** Selects the callback URL used to begin an authentication attempt. */
export interface AuthenticationCallbackUrlResolver {
  resolve(request: Request, strategy_id: string): string | null;
}

/** Default behavior for explicitly composed/test application services. */
export class RequestOriginAuthenticationCallbackUrlResolver
  implements AuthenticationCallbackUrlResolver {
  resolve(request: Request, strategy_id: string): string {
    return new URL(`/auth/${strategy_id}/callback`, request.url).href;
  }
}

export interface ConfiguredAuthenticationCallbackUrlResolverOptions {
  readonly configured_callback_url?: string;
  readonly request_host_pattern?: string;
}

/**
 * Keeps the configured callback unless a deployment explicitly allowlists
 * request-derived HTTPS hosts. Request Origin/Referer headers are not trusted.
 */
export class ConfiguredAuthenticationCallbackUrlResolver
  implements AuthenticationCallbackUrlResolver {
  readonly #configured_callback_url: string | null;
  readonly #request_host_matcher: RequestHostMatcher | null;

  constructor(options: ConfiguredAuthenticationCallbackUrlResolverOptions) {
    if (
      options.configured_callback_url === undefined &&
      options.request_host_pattern === undefined
    ) {
      throw new TypeError(
        "callback URL resolver requires a configured URL or request host pattern",
      );
    }
    this.#configured_callback_url = options.configured_callback_url ?? null;
    this.#request_host_matcher = options.request_host_pattern === undefined
      ? null
      : new RequestHostMatcher(options.request_host_pattern);
  }

  resolve(request: Request, strategy_id: string): string | null {
    if (this.#request_host_matcher === null) {
      return this.#configured_callback_url;
    }

    const request_url = new URL(request.url);
    if (!this.#request_host_matcher.matches(request_url)) return null;
    return new URL(`/auth/${strategy_id}/callback`, request_url.origin).href;
  }
}

/** Compiled once so malformed operator configuration fails during startup. */
export class RequestHostMatcher {
  readonly #pattern: RegExp;

  constructor(pattern: string) {
    this.#pattern = new RegExp(pattern, "i");
  }

  matches(url: URL): boolean {
    if (
      url.protocol !== "https:" || url.username !== "" ||
      url.password !== "" || url.host.length === 0 ||
      url.host.length > MAX_REQUEST_HOST_LENGTH
    ) {
      return false;
    }
    const match = this.#pattern.exec(url.host);
    return match !== null && match.index === 0 &&
      match[0].length === url.host.length;
  }
}
