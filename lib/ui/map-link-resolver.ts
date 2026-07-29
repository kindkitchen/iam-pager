/**
 * Reader-side seam between a stored link and the Maps URL the step editor can
 * actually understand.
 *
 * An official short link (`maps.app.goo.gl/…`) is an alias: it carries no
 * place, no coordinates and no stops, only a key Google resolves over the
 * network. Everything downstream — the stop frame, the map pin, framing two
 * steps into one route — therefore asks this seam for a *canonical* URL first
 * instead of parsing the stored one. A link that already addresses Maps is
 * canonical as it stands and never touches the network.
 *
 * Nothing here knows about Preact or the DOM: the browser implementation only
 * differs in where the expansion comes from.
 */
import { parse_google_maps_url } from "../maps/parse.ts";
import { map_link_expansion_path } from "./map-link-expansion.ts";

/** What is known about one stored URL. */
export type MapLinkState =
  /** Not a Google Maps link at all. */
  | "foreign"
  /** Readable as it stands. */
  | "canonical"
  /** An alias nobody has expanded yet. */
  | "unresolved"
  /** An alias currently being expanded. */
  | "pending"
  /** An alias whose target is known. */
  | "resolved"
  /** An alias that could not be expanded. */
  | "failed";

/**
 * Bounded lookup: one expansion per distinct alias, answered from memory
 * afterwards. Any source (HTTP endpoint, preloaded map, test double)
 * satisfies it.
 */
export interface MapLinkResolver {
  state(url: string): MapLinkState;
  /** Canonical URL known right now, or `null` while it is not known. */
  resolved(url: string): string | null;
  /** Resolves the alias at most once; `null` when it cannot be expanded. */
  resolve(url: string): Promise<string | null>;
}

/** True when a value needs the network before it can be read as a frame. */
export function is_short_map_link(url: string): boolean {
  return parse_google_maps_url(url).kind === "short_link";
}

function is_canonical(url: string): boolean {
  const link = parse_google_maps_url(url);
  return link.kind === "point" || link.kind === "route";
}

/** Fixed answers, used by tests and by any preloaded expansion table. */
export class StaticMapLinkResolver implements MapLinkResolver {
  readonly #expansions: Map<string, string | null>;

  constructor(expansions: Readonly<Record<string, string | null>> = {}) {
    this.#expansions = new Map(Object.entries(expansions));
  }

  state(url: string): MapLinkState {
    if (is_canonical(url)) return "canonical";
    if (!is_short_map_link(url)) return "foreign";
    if (!this.#expansions.has(url)) return "unresolved";
    return this.#expansions.get(url) === null ? "failed" : "resolved";
  }

  resolved(url: string): string | null {
    if (is_canonical(url)) return url;
    return this.#expansions.get(url) ?? null;
  }

  resolve(url: string): Promise<string | null> {
    return Promise.resolve(this.resolved(url));
  }
}

export interface RemoteMapLinkResolverOptions {
  /** Site endpoint that follows the redirect on the reader's behalf. */
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
  /** Notified once per settled alias, so a surface can re-render. */
  readonly on_settled?: (url: string, canonical: string | null) => void;
}

/**
 * Expands aliases through the site endpoint, once per URL. A browser cannot
 * follow the redirect itself, and the answer never changes, so both the
 * in-flight request and its outcome are shared.
 */
export class RemoteMapLinkResolver implements MapLinkResolver {
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #on_settled?: (url: string, canonical: string | null) => void;
  readonly #settled = new Map<string, string | null>();
  readonly #in_flight = new Map<string, Promise<string | null>>();

  constructor(options: RemoteMapLinkResolverOptions = {}) {
    this.#endpoint = options.endpoint ?? map_link_expansion_path;
    this.#fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    if (options.on_settled) this.#on_settled = options.on_settled;
  }

  state(url: string): MapLinkState {
    if (is_canonical(url)) return "canonical";
    if (!is_short_map_link(url)) return "foreign";
    if (this.#in_flight.has(url)) return "pending";
    if (!this.#settled.has(url)) return "unresolved";
    return this.#settled.get(url) === null ? "failed" : "resolved";
  }

  resolved(url: string): string | null {
    if (is_canonical(url)) return url;
    return this.#settled.get(url) ?? null;
  }

  resolve(url: string): Promise<string | null> {
    const state = this.state(url);
    if (state !== "unresolved") {
      return this.#in_flight.get(url) ?? Promise.resolve(this.resolved(url));
    }
    const request = this.#expand(url).then((canonical) => {
      this.#in_flight.delete(url);
      this.#settled.set(url, canonical);
      this.#on_settled?.(url, canonical);
      return canonical;
    });
    this.#in_flight.set(url, request);
    return request;
  }

  async #expand(url: string): Promise<string | null> {
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json().catch(() => ({}));
      const expanded = (data as { url?: unknown }).url;
      if (!response.ok || typeof expanded !== "string") return null;
      return is_canonical(expanded) ? expanded : null;
    } catch {
      return null;
    }
  }
}
