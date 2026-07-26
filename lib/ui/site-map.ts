import type { Session } from "../session/model.ts";

/**
 * Every logical destination the site exposes. The identifier — not the URL — is
 * the stable name; hrefs are one projection of the map and another front-end
 * may route them differently.
 */
export type SiteDestinationId =
  | "home"
  | "publish"
  | "explore"
  | "manage"
  | "api_keys"
  | "about"
  | "demo"
  | "invite";

/** Who a destination is offered to, decided from the session alone. */
export type SiteAudience = "everyone" | "guest" | "creator";

/** Hub grouping; ordering inside a group follows the map order. */
export type SiteDestinationGroup = "create" | "discover" | "account" | "learn";

export interface SiteDestinationDefinition {
  readonly id: SiteDestinationId;
  readonly href: string;
  readonly label: string;
  /** One-line hub description; never rendered logic, only copy. */
  readonly summary: string;
  readonly audience: SiteAudience;
  readonly group: SiteDestinationGroup;
  /** Whether the compact top navigation carries this destination. */
  readonly in_navigation: boolean;
  /** Whether the home hub carries this destination as a card. */
  readonly in_hub: boolean;
}

/**
 * Complete site map. Routes, navigation, hub cards, and breadcrumbs are all
 * derived from this one declaration so a new destination is added once.
 */
export const site_map: readonly SiteDestinationDefinition[] = [
  {
    id: "home",
    href: "/site",
    label: "Home",
    summary: "Every destination of this site in one place.",
    audience: "everyone",
    group: "discover",
    in_navigation: true,
    in_hub: false,
  },
  {
    id: "publish",
    href: "/site/publish",
    label: "Publish",
    summary:
      "Generate a page: choose paths, write Markdown or attach a PDF, publish.",
    audience: "everyone",
    group: "create",
    in_navigation: true,
    in_hub: true,
  },
  {
    id: "manage",
    href: "/site/manage",
    label: "Manage",
    summary:
      "Namespaces, storage connections, and every page you already published.",
    audience: "creator",
    group: "create",
    in_navigation: true,
    in_hub: true,
  },
  {
    id: "explore",
    href: "/site/explore",
    label: "Explore",
    summary:
      "Browse and filter public creator pages by namespace, name, or tag.",
    audience: "everyone",
    group: "discover",
    in_navigation: true,
    in_hub: true,
  },
  {
    id: "demo",
    href: "/site/demo",
    label: "Demo",
    summary: "A short walkthrough from an empty path to a shared URL.",
    audience: "everyone",
    group: "learn",
    in_navigation: false,
    in_hub: true,
  },
  {
    id: "about",
    href: "/site/about",
    label: "About",
    summary: "What this platform promises, and what it deliberately does not.",
    audience: "everyone",
    group: "learn",
    in_navigation: false,
    in_hub: true,
  },
  {
    id: "api_keys",
    href: "/site/api-keys",
    label: "API keys",
    summary: "Issue and revoke keys that drive the same API the site uses.",
    audience: "creator",
    group: "account",
    in_navigation: true,
    in_hub: true,
  },
  {
    id: "invite",
    href: "/site/invite",
    label: "Invite",
    summary:
      "Sign in to reserve namespaces, keep pages private, and manage them.",
    audience: "guest",
    group: "account",
    in_navigation: false,
    in_hub: true,
  },
];

/** Reads the map without exposing session details to components. */
export interface SiteMapReader {
  /** Destinations visible to this session, in map order. */
  visible(session: Session): readonly SiteDestinationDefinition[];
  /** Single destination by identifier; throws for an unknown identifier. */
  destination(id: SiteDestinationId): SiteDestinationDefinition;
}

/** Session-driven reader; the only place audience rules are interpreted. */
export class SessionSiteMapReader implements SiteMapReader {
  readonly #destinations: readonly SiteDestinationDefinition[];

  constructor(destinations: readonly SiteDestinationDefinition[] = site_map) {
    this.#destinations = destinations;
  }

  visible(session: Session): readonly SiteDestinationDefinition[] {
    const authenticated = session.kind === "authenticated";
    return this.#destinations.filter((destination) =>
      destination.audience === "everyone" ||
      (destination.audience === "creator") === authenticated
    );
  }

  destination(id: SiteDestinationId): SiteDestinationDefinition {
    const found = this.#destinations.find((entry) => entry.id === id);
    if (found === undefined) throw new Error(`unknown destination: ${id}`);
    return found;
  }
}

export const site_map_reader: SiteMapReader = new SessionSiteMapReader();

/** True when `pathname` addresses this destination, ignoring a trailing slash. */
export function is_current_destination(
  destination: SiteDestinationDefinition,
  pathname: string,
): boolean {
  const normalized = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  if (destination.id === "home") {
    return normalized === "/" || normalized === "/site";
  }
  return normalized === destination.href;
}
