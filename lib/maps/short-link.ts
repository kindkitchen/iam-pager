/**
 * Expansion of the official Google short links (`maps.app.goo.gl`,
 * `goo.gl/maps`). Their target is only knowable over the network, so this is
 * kept apart from the pure parsing/building code and behind an interface any
 * caller can replace (cache, proxy, test double).
 */
import {
  MapsLinkError,
  type RouteInput,
  type RouteOptions,
  type ShortLinkResolver,
} from "./model.ts";
import { as_map_link, route_url_of, split_route_args } from "./route.ts";

const CANONICAL_RE = /https?:\/\/(?:www\.)?google\.[a-z.]+\/maps[^"'\\\s]*/;

/** Follows the redirect chain with `fetch`. */
export const fetch_short_link_resolver: ShortLinkResolver = {
  async expand(url: string): Promise<string> {
    const response = await fetch(url, { redirect: "follow" });
    const final = response.url;
    if (final && !/goo\.gl$/.test(new URL(final).hostname)) {
      await response.body?.cancel();
      return final;
    }
    // Some short links land on an interstitial that only carries the target
    // in the document body.
    const body = await response.text();
    const match = CANONICAL_RE.exec(body);
    if (!match) {
      throw new MapsLinkError(
        "unresolved_short_link",
        `Could not expand short link: ${url}`,
      );
    }
    return match[0].replace(/&amp;/g, "&");
  },
};

/** Replaces every short link argument with its expanded URL. */
export async function expand_short_links(
  inputs: RouteInput[],
  resolver: ShortLinkResolver = fetch_short_link_resolver,
): Promise<RouteInput[]> {
  return await Promise.all(inputs.map(async (input) => {
    const link = as_map_link(input);
    return link.kind === "short_link" ? await resolver.expand(link.url) : input;
  }));
}

/** Options of the network-aware variant. */
export interface AsyncRouteOptions extends RouteOptions {
  resolver?: ShortLinkResolver;
}

/**
 * Same contract as {@link to_route_url}, but official short links are
 * expanded first (needs `--allow-net` with the default resolver).
 */
export async function to_route_url_async(
  ...args: (RouteInput | AsyncRouteOptions | undefined)[]
): Promise<string> {
  const { inputs, options } = split_route_args(args);
  const { resolver, ...route_options } = options as AsyncRouteOptions;
  const expanded = await expand_short_links(inputs, resolver);
  return route_url_of([...expanded, route_options]);
}
