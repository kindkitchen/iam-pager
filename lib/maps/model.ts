/**
 * Vocabulary of the Google Maps link utilities.
 *
 * Everything here is plain data: a link is parsed into points, points are
 * assembled into a route, and the route is formatted as a Google Maps URL.
 * The web surface is only one consumer of this model.
 */

/** Travel modes accepted by the Google Maps URL API (`travelmode=`). */
export type TravelMode = "driving" | "walking" | "bicycling" | "transit";

/**
 * One addressable stop of a route.
 *
 * `current_location` is not an address: the Google Maps URL API expresses it
 * by *omitting* `origin`, so the app resolves the device position when the
 * user is redirected. It is therefore only meaningful as the first stop.
 *
 * `label` is presentation only — the name Maps showed for the place. It never
 * addresses anything, so it is ignored by formatting and by identity.
 */
export type MapPoint =
  | { kind: "current_location" }
  | { kind: "coords"; lat: number; lng: number; label?: string }
  | { kind: "query"; query: string; place_id?: string; label?: string };

/** Singleton for the implicit "wherever the user is" stop. */
export const CURRENT_LOCATION: MapPoint = { kind: "current_location" };

/**
 * What a Google Maps URL turned out to be.
 *
 * `short_link` is an official shortener target (`maps.app.goo.gl`,
 * `goo.gl/maps`) whose real content is only known after an HTTP redirect,
 * hence it stays a distinct case instead of a guess.
 */
export type MapLink =
  | { kind: "point"; point: MapPoint }
  | {
    kind: "route";
    /** Absent origin means "start from the current location". */
    origin?: MapPoint;
    waypoints: MapPoint[];
    destination: MapPoint;
    travel_mode?: TravelMode;
  }
  | { kind: "short_link"; url: string }
  | { kind: "unknown"; input: string };

/** Anything accepted as a route stop by the builder. */
export type RouteInput = string | MapPoint | MapLink;

/** Knobs applied to the generated route URL. */
export interface RouteOptions {
  /** Overrides any travel mode carried by the inputs. */
  travel_mode?: TravelMode;
  /** `navigate` asks Maps to start turn-by-turn guidance immediately. */
  dir_action?: "navigate";
  /**
   * Keep an already-complete route URL untouched (default `true`).
   * Set to `false` to always re-emit the canonical `api=1` form.
   */
  passthrough_routes?: boolean;
}

/** Reasons the utility refuses to produce a route URL. */
export type MapsErrorCode =
  /** A short link was given to the sync API and cannot be expanded offline. */
  | "unresolved_short_link"
  /** The input is not a Google Maps link nor a usable place/coordinate. */
  | "unsupported_input"
  /** Nothing addressable was left after flattening the arguments. */
  | "no_destination";

export class MapsLinkError extends Error {
  constructor(readonly code: MapsErrorCode, message: string) {
    super(message);
    this.name = "MapsLinkError";
  }
}

/**
 * Bidirectional contract of a link dialect. `parse` recognises a URL flavour;
 * implementations plug into the builder without further wiring.
 */
export interface MapLinkParser {
  parse(input: string): MapLink;
}

/** Expands official Google short links to their canonical URL. */
export interface ShortLinkResolver {
  expand(url: string): Promise<string>;
}

/** Renders an ordered list of stops as a provider URL. */
export interface RouteUrlBuilder {
  build(points: MapPoint[], options?: RouteOptions): string;
}

/** The Maps URL API caps a directions link at nine intermediate stops. */
export const MAX_WAYPOINTS = 9;

/** Numeric form used in URLs: fixed precision without trailing noise. */
export function format_coord(value: number): string {
  return String(Number(value.toFixed(7)));
}

/** Value of a stop as it appears in `origin`/`destination`/`waypoints`. */
export function format_point(point: MapPoint): string {
  switch (point.kind) {
    case "coords":
      return `${format_coord(point.lat)},${format_coord(point.lng)}`;
    case "query":
      return point.query;
    case "current_location":
      return "";
  }
}

/** Identity used to collapse repeated stops when routes are chained. */
export function point_key(point: MapPoint): string {
  return point.kind === "query" && point.place_id
    ? `query:${point.place_id}`
    : `${point.kind}:${format_point(point).toLowerCase()}`;
}

/** Ordered stops of a link, with the implicit origin made explicit. */
export function link_points(link: MapLink): MapPoint[] {
  switch (link.kind) {
    case "point":
      return [link.point];
    case "route":
      return [
        link.origin ?? CURRENT_LOCATION,
        ...link.waypoints,
        link.destination,
      ];
    case "short_link":
      throw new MapsLinkError(
        "unresolved_short_link",
        `Short link must be expanded first: ${link.url}`,
      );
    case "unknown":
      throw new MapsLinkError(
        "unsupported_input",
        `Not a Google Maps location: ${link.input}`,
      );
  }
}
