/**
 * Turns Google Maps links (and plain places) into one directions URL.
 *
 * Rules encoded here:
 * - a lone link that already is a route is returned untouched;
 * - a lone place becomes a route whose origin is omitted, so Maps asks for
 *   the device location at redirect time;
 * - many arguments are chained in order, a route argument contributing all of
 *   its stops, and the current location surviving only as the very first stop.
 */
import {
  format_point,
  link_points,
  type MapLink,
  type MapPoint,
  MapsLinkError,
  MAX_WAYPOINTS,
  point_key,
  type RouteInput,
  type RouteOptions,
  type RouteUrlBuilder,
  type TravelMode,
} from "./model.ts";
import { parse_google_maps_url } from "./parse.ts";

const MAPS_DIR_URL = "https://www.google.com/maps/dir/";

const MAP_LINK_KINDS = new Set(["point", "route", "short_link", "unknown"]);

function is_map_link(value: MapPoint | MapLink): value is MapLink {
  return MAP_LINK_KINDS.has(value.kind);
}

/** Resolves any accepted argument into a link. */
export function as_map_link(input: RouteInput): MapLink {
  if (typeof input === "string") return parse_google_maps_url(input);
  if (is_map_link(input)) return input;
  return { kind: "point", point: input };
}

/**
 * Flattens arguments into the stop sequence actually used for the URL:
 * current location kept only in the lead, consecutive duplicates collapsed.
 */
export function route_points(inputs: RouteInput[]): MapPoint[] {
  const flat: MapPoint[] = [];
  for (const input of inputs) flat.push(...link_points(as_map_link(input)));

  const points: MapPoint[] = [];
  for (const point of flat) {
    if (point.kind === "current_location" && points.length > 0) continue;
    const previous = points.at(-1);
    if (previous && point_key(previous) === point_key(point)) continue;
    points.push(point);
  }
  if (points.length === 1 && points[0].kind === "current_location") return [];
  return points;
}

function travel_mode_of(inputs: RouteInput[]): TravelMode | undefined {
  for (const input of inputs) {
    const link = as_map_link(input);
    if (link.kind === "route" && link.travel_mode) return link.travel_mode;
  }
  return undefined;
}

function set_point(
  params: URLSearchParams,
  name: "origin" | "destination",
  point: MapPoint,
): void {
  params.set(name, format_point(point));
  if (point.kind === "query" && point.place_id) {
    params.set(`${name}_place_id`, point.place_id);
  }
}

/**
 * Formats stops as the documented cross-platform directions URL, which the
 * Google Maps app intercepts on Android and iOS.
 */
export function build_route_url(
  points: MapPoint[],
  options: RouteOptions = {},
): string {
  const stops = points.filter((point, index) =>
    point.kind !== "current_location" || index === 0
  );
  const addressable = stops.filter((point) =>
    point.kind !== "current_location"
  );
  if (addressable.length === 0) {
    throw new MapsLinkError("no_destination", "No destination to route to.");
  }

  const lead = stops[0].kind === "current_location" ? undefined : stops[0];
  const rest = stops.slice(1);
  // A single addressable stop is a destination, never an origin: the missing
  // origin is what makes Maps start from the user's current location.
  const destination = rest.pop() ?? lead!;
  const origin = destination === lead ? undefined : lead;
  const waypoints = rest;

  const url = new URL(MAPS_DIR_URL);
  url.searchParams.set("api", "1");
  if (origin) set_point(url.searchParams, "origin", origin);
  set_point(url.searchParams, "destination", destination);
  if (waypoints.length > 0) {
    url.searchParams.set(
      "waypoints",
      waypoints.slice(0, MAX_WAYPOINTS).map(format_point).join("|"),
    );
  }
  const travel_mode = options.travel_mode;
  if (travel_mode) url.searchParams.set("travelmode", travel_mode);
  if (options.dir_action) {
    url.searchParams.set("dir_action", options.dir_action);
  }
  return url.href;
}

/** Default builder instance satisfying {@link RouteUrlBuilder}. */
export const google_route_builder: RouteUrlBuilder = { build: build_route_url };

/** One positional argument: a stop, or the trailing options object. */
export type RouteArg = RouteInput | RouteOptions | undefined;

export function is_route_options(value: unknown): value is RouteOptions {
  return typeof value === "object" && value !== null && !("kind" in value);
}

/** Separates stops from the optional trailing options object. */
export function split_route_args(
  args: RouteArg[],
): { inputs: RouteInput[]; options: RouteOptions } {
  const given = args.filter((arg) => arg !== undefined);
  const last = given.at(-1);
  const options = is_route_options(last) ? last : {};
  const inputs =
    (is_route_options(last) ? given.slice(0, -1) : given) as RouteInput[];
  return { inputs, options };
}

/**
 * Builds one Google Maps route URL out of every argument, in order.
 *
 * @example
 * to_route_url("https://maps.google.com/?q=50.45,30.52");
 * to_route_url(home_link, office_link, { travel_mode: "walking" });
 */
export function to_route_url(input: RouteInput, options?: RouteOptions): string;
export function to_route_url(
  from: RouteInput,
  to: RouteInput,
  ...rest: (RouteInput | RouteOptions)[]
): string;
export function to_route_url(...args: RouteArg[]): string {
  return route_url_of(args);
}

/** Array-shaped entry point used by the overloads and the async variant. */
export function route_url_of(args: RouteArg[]): string {
  const { inputs, options } = split_route_args(args);
  if (inputs.length === 0) {
    throw new MapsLinkError("no_destination", "No location given.");
  }

  const untouched = options.passthrough_routes !== false &&
    options.travel_mode === undefined && options.dir_action === undefined;
  if (untouched && inputs.length === 1 && typeof inputs[0] === "string") {
    const link = parse_google_maps_url(inputs[0]);
    if (link.kind === "route") return inputs[0];
  }

  const points = route_points(inputs);
  return build_route_url(points, {
    ...options,
    travel_mode: options.travel_mode ?? travel_mode_of(inputs),
  });
}

/** Convenience alias mirroring the "point to route" reading of the utility. */
export const to_google_maps_route = to_route_url;
