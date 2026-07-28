/**
 * Server-side expansion of official Google short links for the beta step
 * editor. The browser cannot follow `maps.app.goo.gl` redirects itself
 * (cross-origin), so the surface asks the site, and the site only ever
 * dereferences URLs the parser already recognised as Google short links.
 */
import { parse_google_maps_url } from "../maps/parse.ts";
import type { ShortLinkResolver } from "../maps/model.ts";
import { fetch_short_link_resolver } from "../maps/short-link.ts";

export type MapLinkExpansion =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: "not_a_short_link" | "unreachable" };

/** Bounded lookup contract; any resolver (cache, proxy) satisfies it. */
export interface MapLinkExpansionService {
  expand(url: unknown): Promise<MapLinkExpansion>;
}

export class ShortLinkExpansionService implements MapLinkExpansionService {
  constructor(
    private readonly resolver: ShortLinkResolver = fetch_short_link_resolver,
  ) {}

  async expand(url: unknown): Promise<MapLinkExpansion> {
    if (typeof url !== "string" || url.length > 2048) {
      return { ok: false, reason: "not_a_short_link" };
    }
    const link = parse_google_maps_url(url);
    if (link.kind !== "short_link") {
      return { ok: false, reason: "not_a_short_link" };
    }
    try {
      const expanded = await this.resolver.expand(link.url);
      const parsed = parse_google_maps_url(expanded);
      return parsed.kind === "point" || parsed.kind === "route"
        ? { ok: true, url: expanded }
        : { ok: false, reason: "unreachable" };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  }
}

/** HTTP status carried by each outcome. */
export function map_link_expansion_status(result: MapLinkExpansion): number {
  if (result.ok) return 200;
  return result.reason === "not_a_short_link" ? 400 : 502;
}

export const map_link_expansion_service: MapLinkExpansionService =
  new ShortLinkExpansionService();
