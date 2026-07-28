/**
 * Reader for the Google Maps URL dialects a user can realistically paste:
 * the documented `api=1` links, the interactive `/maps/place|dir|search/@`
 * links, the legacy `?q=/?saddr=/?daddr=` links, `geo:` URIs, official short
 * links, and bare coordinates or place text.
 */
import {
  type MapLink,
  type MapLinkParser,
  type MapPoint,
  type TravelMode,
} from "./model.ts";

const COORDS_RE =
  /^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)(?:\s*,\s*[\d.]+[a-z])?$/;
const PLACE_COORDS_RE = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/;
const TRAVEL_MODE_DATA_RE = /!3e(\d)/;
const GOOGLE_HOST_RE = /(?:^|\.)google(?:\.[a-z]{2,3}){1,2}$/;
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
const CURRENT_LOCATION_TEXT = new Set([
  "current location",
  "current+location",
  "my location",
  "here",
]);

/** `dirflg` (legacy) and `!3e` (interactive) travel mode codes. */
const DIRFLG_MODES: Record<string, TravelMode> = {
  d: "driving",
  w: "walking",
  b: "bicycling",
  r: "transit",
};
const DATA_MODES: Record<string, TravelMode> = {
  "0": "driving",
  "1": "bicycling",
  "2": "walking",
  "3": "transit",
};

function is_finite_lat_lng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function decode_segment(segment: string): string {
  const spaced = segment.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/** Interprets free text: current location, coordinates, or a search query. */
export function point_from_text(
  text: string,
  place_id?: string,
): MapPoint | undefined {
  const value = text.trim().replace(/^@/, "").replace(/^loc:/i, "").trim();
  if (value === "" || CURRENT_LOCATION_TEXT.has(value.toLowerCase())) {
    return place_id ? undefined : { kind: "current_location" };
  }
  const coords = COORDS_RE.exec(value);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (is_finite_lat_lng(lat, lng)) return { kind: "coords", lat, lng };
  }
  return place_id
    ? { kind: "query", query: value, place_id }
    : { kind: "query", query: value };
}

function travel_mode_of(url: URL): TravelMode | undefined {
  const explicit = url.searchParams.get("travelmode");
  if (explicit && explicit in DATA_MODES === false) {
    const mode = explicit.toLowerCase();
    if (["driving", "walking", "bicycling", "transit"].includes(mode)) {
      return mode as TravelMode;
    }
  }
  const dirflg = url.searchParams.get("dirflg");
  if (dirflg && DIRFLG_MODES[dirflg[0]]) return DIRFLG_MODES[dirflg[0]];
  const data = TRAVEL_MODE_DATA_RE.exec(url.href);
  if (data) return DATA_MODES[data[1]];
  return undefined;
}

/** Splits the legacy `daddr=A to:B to:C` chain. */
function split_legacy_stops(value: string): string[] {
  return value.split(/\s+to:/i).map((part) => part.trim()).filter((part) =>
    part !== ""
  );
}

function route_of(
  stops: MapPoint[],
  travel_mode: TravelMode | undefined,
): MapLink | undefined {
  const points = stops.filter((point, index) =>
    point.kind !== "current_location" || index === 0
  );
  if (points.length < 2) return undefined;
  const [origin, ...rest] = points;
  const destination = rest.pop()!;
  return {
    kind: "route",
    ...(origin.kind === "current_location" ? {} : { origin }),
    waypoints: rest,
    destination,
    ...(travel_mode ? { travel_mode } : {}),
  };
}

function point_of(point: MapPoint | undefined): MapLink | undefined {
  return point && point.kind !== "current_location"
    ? { kind: "point", point }
    : undefined;
}

/** Coordinates carried by `/@lat,lng,17z` or the `data=!3d!4d` payload. */
function embedded_coords(url: URL): MapPoint | undefined {
  const place = PLACE_COORDS_RE.exec(url.href);
  if (place) {
    const lat = Number(place[1]);
    const lng = Number(place[2]);
    if (is_finite_lat_lng(lat, lng)) return { kind: "coords", lat, lng };
  }
  const at = url.pathname.split("/").find((segment) => segment.startsWith("@"));
  if (at) {
    const point = point_from_text(decode_segment(at));
    if (point?.kind === "coords") return point;
  }
  return undefined;
}

function param_point(url: URL, ...names: string[]): MapPoint | undefined {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value === null || value.trim() === "") continue;
    const place_id = url.searchParams.get(`${name}_place_id`) ??
      (name === "query" ? url.searchParams.get("query_place_id") : null) ??
      undefined;
    const point = point_from_text(value, place_id ?? undefined);
    if (point) return point;
  }
  return undefined;
}

/** Path segments that are decoration (viewport, data blob, flags). */
function is_meta_segment(segment: string): boolean {
  return segment.startsWith("@") || segment.includes("=");
}

function parse_dir(url: URL, tail: string[]): MapLink | undefined {
  const travel_mode = travel_mode_of(url);
  const stops: MapPoint[] = [];

  const origin = param_point(url, "origin", "saddr");
  if (origin) stops.push(origin);

  const waypoints = url.searchParams.get("waypoints");
  if (waypoints) {
    for (const raw of waypoints.split("|")) {
      const point = point_from_text(raw);
      if (point && point.kind !== "current_location") stops.push(point);
    }
  }
  const destination = param_point(url, "destination");
  if (destination) stops.push(destination);

  const daddr = url.searchParams.get("daddr");
  if (daddr) {
    for (const stop of split_legacy_stops(daddr)) {
      const point = point_from_text(stop);
      if (point && point.kind !== "current_location") stops.push(point);
    }
  }

  // A parameter form without an origin still is a route: Maps starts from
  // wherever the user is when the link is opened.
  if (stops.length > 0 && !origin) stops.unshift({ kind: "current_location" });

  if (stops.length === 0) {
    for (const segment of tail) {
      if (is_meta_segment(segment)) continue;
      const point = point_from_text(decode_segment(segment));
      if (point) stops.push(point);
    }
    // `/maps/dir//Place` — the empty first segment is the current location.
    if (tail[0] === "" && stops[0]?.kind !== "current_location") {
      stops.unshift({ kind: "current_location" });
    }
  }

  const route = route_of(stops, travel_mode);
  if (route) return route;
  const single = stops.find((point) => point.kind !== "current_location");
  return point_of(single);
}

function parse_google(url: URL): MapLink {
  const segments = url.pathname.split("/").slice(1);
  const maps_index = segments.indexOf("maps");
  const tail = maps_index === -1 ? segments : segments.slice(maps_index + 1);
  const head = tail[0] ?? "";

  if (head === "dir") {
    const route = parse_dir(url, tail.slice(1));
    if (route) return route;
  }

  if (url.searchParams.has("saddr") || url.searchParams.has("daddr")) {
    const route = parse_dir(url, []);
    if (route) return route;
  }

  if (head === "place" || head === "search" || head === "preview") {
    const named = tail[1] && !is_meta_segment(tail[1])
      ? point_from_text(decode_segment(tail[1]))
      : undefined;
    const coords = embedded_coords(url);
    const point = coords ?? param_point(url, "query", "q") ?? named;
    const link = point_of(point);
    if (link) return link;
  }

  const param = param_point(url, "query", "q", "destination", "ll", "center");
  const link = point_of(param) ?? point_of(embedded_coords(url));
  if (link) return link;

  // `cid=`/`ftid=` only resolve inside Google's own services.
  if (url.searchParams.has("cid")) return { kind: "short_link", url: url.href };
  return { kind: "unknown", input: url.href };
}

function parse_geo(input: string): MapLink {
  const [head, query_string = ""] = input.slice(4).split("?");
  const params = new URLSearchParams(query_string);
  const q = params.get("q");
  if (q) {
    const labelled = q.replace(/\(.*\)$/, "").trim();
    const point = point_from_text(labelled);
    const link = point_of(point);
    if (link) return link;
  }
  const point = point_from_text(head);
  return point_of(point) ?? { kind: "unknown", input };
}

/**
 * Recognises a Google Maps link (or bare place text) without any network
 * access. Official short links are reported as such so the caller can decide
 * to expand them.
 */
export function parse_google_maps_url(input: string): MapLink {
  const value = input.trim();
  if (value === "") return { kind: "unknown", input };
  if (/^geo:/i.test(value)) return parse_geo(value);

  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }

  if (!url) {
    const point = point_from_text(value);
    return point_of(point) ?? { kind: "unknown", input };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "unknown", input };
  }

  const host = url.hostname.toLowerCase();
  if (SHORT_HOSTS.has(host)) {
    const is_maps_short = host === "maps.app.goo.gl" ||
      url.pathname.startsWith("/maps");
    return is_maps_short
      ? { kind: "short_link", url: url.href }
      : { kind: "unknown", input };
  }
  if (GOOGLE_HOST_RE.test(host)) return parse_google(url);
  return { kind: "unknown", input };
}

/** True when the link already is a complete directions link. */
export function is_route_url(input: string): boolean {
  return parse_google_maps_url(input).kind === "route";
}

/** Default parser instance satisfying {@link MapLinkParser}. */
export const google_maps_parser: MapLinkParser = {
  parse: parse_google_maps_url,
};
