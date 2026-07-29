/**
 * Formatting of a single stop as a Google Maps *place* URL.
 *
 * A one-stop frame is not a route: emitting it as a directions link would
 * silently promise a trip from wherever the reader stands, and reading that
 * link back would show an origin nobody asked for. The documented `api=1`
 * search form says exactly one thing — this place — and round-trips through
 * {@link parse_google_maps_url} unchanged.
 */
import { format_point, type MapPoint, MapsLinkError } from "./model.ts";

const MAPS_SEARCH_URL = "https://www.google.com/maps/search/";

/** Formats one addressable point as the documented `api=1` search URL. */
export function build_place_url(point: MapPoint): string {
  if (point.kind === "current_location") {
    throw new MapsLinkError(
      "no_destination",
      "The current location is not a place that can be linked.",
    );
  }
  const url = new URL(MAPS_SEARCH_URL);
  url.searchParams.set("api", "1");
  url.searchParams.set("query", format_point(point));
  if (point.kind === "query" && point.place_id) {
    url.searchParams.set("query_place_id", point.place_id);
  }
  return url.href;
}
