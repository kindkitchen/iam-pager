/**
 * Map step model for the Markdown step editor (beta preview).
 *
 * A map step is an ordinary Markdown link whose URL is a Google Maps link, so
 * nothing new is stored: the document stays `[label](url)`. What the step adds
 * is a *frame* reading of that link — its stops, in order — so two map steps
 * dropped on each other are not merged as text but joined into one ordered
 * stop list, exactly like editing stops in the Google Maps app. The route URL
 * is always regenerated from the frame's top-to-bottom order by `lib/maps`.
 */
import {
  CURRENT_LOCATION,
  type MapPoint,
  MAX_WAYPOINTS,
  point_key,
  type TravelMode,
} from "../maps/model.ts";
import { parse_google_maps_url, point_from_text } from "../maps/parse.ts";
import { build_place_url } from "../maps/place.ts";
import { route_url_of } from "../maps/route.ts";
import {
  DeterministicMarkdownSectionEditor,
  type MarkdownListType,
  type MarkdownSection,
  type MarkdownSectionDraft,
} from "./markdown-section-editor.ts";

/** One stop of a frame: what the user reads, plus what Maps addresses. */
export interface MapRouteStop {
  readonly label: string;
  readonly point: MapPoint;
}

/** One map step: a link label plus the ordered stops behind it. */
export interface MapRouteStep {
  /** `null` keeps the label derived from the stops. */
  readonly label: string | null;
  readonly stops: readonly MapRouteStop[];
  readonly travel_mode: TravelMode | null;
}

/** Splitting one stop out of a frame yields the rest plus the loose step. */
export interface MapRouteSplit {
  readonly remaining: MapRouteStep | null;
  readonly extracted: MapRouteStep;
}

/**
 * Editing contract of the map step. Implementations only rearrange stops; the
 * URL dialect stays owned by `lib/maps`.
 */
export interface MapRouteStepEditor {
  /** Reads a Markdown section as a map step, or `null` when it is not one. */
  read(section: MarkdownSection): MapRouteStep | null;
  /**
   * Reads a bare link pair the same way, so a Link step can be validated
   * before it is offered as a map frame.
   */
  read_link(label: string, url: string): MapRouteStep | null;
  /** True while the frame starts from the device position. */
  has_current_location(step: MapRouteStep): boolean;
  /**
   * Adds or removes the `Your location` stop in one move. It is only ever
   * added in the lead position, the only place Maps can express it.
   */
  toggle_current_location(step: MapRouteStep): MapRouteStep;
  /** Stops behind any pasted place link, route link, or plain place text. */
  stops_from_value(value: string): readonly MapRouteStop[];
  /** Label shown on the frame. */
  label(step: MapRouteStep): string;
  /** Route URL for the current top-to-bottom order. */
  url(step: MapRouteStep): string;
  /** False while the frame cannot address a destination yet. */
  can_generate(step: MapRouteStep): boolean;
  /** Section draft (`label`, `url`) this step serializes to. */
  draft(
    step: MapRouteStep,
    list_type: MarkdownListType | null,
  ): MarkdownSectionDraft;
  /** Rendered Markdown section, keeping any list marker of the previous one. */
  section(step: MapRouteStep, previous?: MarkdownSection): MarkdownSection;
  /** Joins two frames into one ordered stop list. */
  merge(target: MapRouteStep, source: MapRouteStep, at?: number): MapRouteStep;
  add_stops(
    step: MapRouteStep,
    stops: readonly MapRouteStop[],
    at?: number,
  ): MapRouteStep;
  move_stop(
    step: MapRouteStep,
    from_index: number,
    to_index: number,
  ): MapRouteStep;
  remove_stop(step: MapRouteStep, index: number): MapRouteStep | null;
  /** Takes one stop out of the frame as a standalone step. */
  extract_stop(step: MapRouteStep, index: number): MapRouteSplit;
  set_label(step: MapRouteStep, label: string): MapRouteStep;
  set_travel_mode(step: MapRouteStep, mode: TravelMode | null): MapRouteStep;
  /** Human-readable limits the current order runs into. */
  warnings(step: MapRouteStep): readonly string[];
}

export const travel_modes: readonly TravelMode[] = [
  "driving",
  "walking",
  "bicycling",
  "transit",
];

/** Label of the implicit device position, mirroring the Maps app wording. */
export const current_location_label = "Your location";

/** A route is a sequence, so a map step is a list item unless told otherwise. */
export const default_map_list_type: MarkdownListType = "bulleted";

const section_editor = new DeterministicMarkdownSectionEditor();
const label_separator = " → ";

function stop_label(point: MapPoint): string {
  switch (point.kind) {
    case "current_location":
      return current_location_label;
    case "coords":
      return point.label ?? `${point.lat}, ${point.lng}`;
    case "query":
      return point.label ?? point.query;
  }
}

function stop_of(point: MapPoint): MapRouteStop {
  return { label: stop_label(point), point };
}

function is_coordinate_text(value: string): boolean {
  return point_from_text(value)?.kind === "coords";
}

/**
 * The only stop of a link is named by the link text.
 *
 * A place URL addresses a pin by coordinates and has nowhere to carry the name
 * Maps showed for it, so the document's own label is what keeps the place
 * readable: without this, saving and reopening turns every derived label into
 * bare numbers.
 */
function named_stop(point: MapPoint, label: string): MapRouteStop {
  const name = label.trim();
  const nameable = point.kind === "coords" && point.label === undefined &&
    name !== "" && !is_coordinate_text(name);
  return nameable
    ? { label: name, point: { ...point, label: name } }
    : stop_of(point);
}

function assert_index(index: number, length: number, allow_end = false): void {
  const maximum = allow_end ? length : length - 1;
  if (!Number.isInteger(index) || index < 0 || index > maximum) {
    throw new RangeError(`Map stop index ${index} is out of range`);
  }
}

/** Collapses stops that address the same place twice in a row. */
function dedupe(stops: readonly MapRouteStop[]): MapRouteStop[] {
  const kept: MapRouteStop[] = [];
  for (const stop of stops) {
    const previous = kept.at(-1);
    if (previous && point_key(previous.point) === point_key(stop.point)) {
      continue;
    }
    kept.push(stop);
  }
  return kept;
}

export class DeterministicMapRouteStepEditor implements MapRouteStepEditor {
  read(section: MarkdownSection): MapRouteStep | null {
    return section.type === "link"
      ? this.read_link(section.label, section.url)
      : null;
  }

  read_link(label: string, url: string): MapRouteStep | null {
    const link = parse_google_maps_url(url);
    if (link.kind !== "point" && link.kind !== "route") return null;

    const stops = link.kind === "point" ? [named_stop(link.point, label)] : [
      stop_of(link.origin ?? CURRENT_LOCATION),
      ...link.waypoints.map(stop_of),
      stop_of(link.destination),
    ];
    const step: MapRouteStep = {
      label: null,
      stops,
      travel_mode: link.kind === "route" ? link.travel_mode ?? null : null,
    };
    return label === this.label(step) ? step : { ...step, label };
  }

  has_current_location(step: MapRouteStep): boolean {
    return step.stops.some((stop) => stop.point.kind === "current_location");
  }

  toggle_current_location(step: MapRouteStep): MapRouteStep {
    if (this.has_current_location(step)) {
      return {
        ...step,
        stops: step.stops.filter((stop) =>
          stop.point.kind !== "current_location"
        ),
      };
    }
    // Lead position only: Maps expresses the device position by an absent
    // origin, so it cannot sit anywhere else.
    return {
      ...step,
      stops: dedupe([stop_of(CURRENT_LOCATION), ...step.stops]),
    };
  }

  stops_from_value(value: string): readonly MapRouteStop[] {
    const link = parse_google_maps_url(value);
    if (link.kind === "point") return [stop_of(link.point)];
    if (link.kind !== "route") return [];
    return [
      stop_of(link.origin ?? CURRENT_LOCATION),
      ...link.waypoints.map(stop_of),
      stop_of(link.destination),
    ];
  }

  label(step: MapRouteStep): string {
    if (step.label !== null) return step.label;
    return step.stops.map((stop) => stop.label).join(label_separator);
  }

  /**
   * One addressable stop is a place, not a trip: a directions URL without an
   * origin reads back as "start from your location", which would re-check the
   * toggle the reader just cleared. A chosen travel mode is a trip again, and
   * only the directions form can carry it.
   */
  url(step: MapRouteStep): string {
    const [only] = step.stops;
    if (
      step.stops.length === 1 && only.point.kind !== "current_location" &&
      step.travel_mode === null
    ) {
      return build_place_url(only.point);
    }
    return route_url_of([
      ...step.stops.map((stop) => stop.point),
      step.travel_mode === null ? {} : { travel_mode: step.travel_mode },
    ]);
  }

  can_generate(step: MapRouteStep): boolean {
    return step.stops.some((stop) => stop.point.kind !== "current_location");
  }

  draft(
    step: MapRouteStep,
    list_type: MarkdownListType | null,
  ): MarkdownSectionDraft {
    return {
      type: "link",
      label: this.label(step),
      url: this.can_generate(step) ? this.url(step) : "",
      list_type,
    };
  }

  section(step: MapRouteStep, previous?: MarkdownSection): MarkdownSection {
    const draft = this.draft(step, previous?.list?.type ?? null);
    return previous
      ? section_editor.update(previous, draft)
      : section_editor.create(draft);
  }

  merge(
    target: MapRouteStep,
    source: MapRouteStep,
    at = target.stops.length,
  ): MapRouteStep {
    assert_index(at, target.stops.length, true);
    return {
      label: target.label ?? source.label,
      stops: dedupe([
        ...target.stops.slice(0, at),
        ...source.stops,
        ...target.stops.slice(at),
      ]),
      travel_mode: target.travel_mode ?? source.travel_mode,
    };
  }

  add_stops(
    step: MapRouteStep,
    stops: readonly MapRouteStop[],
    at = step.stops.length,
  ): MapRouteStep {
    assert_index(at, step.stops.length, true);
    return {
      ...step,
      stops: dedupe([
        ...step.stops.slice(0, at),
        ...stops,
        ...step.stops.slice(at),
      ]),
    };
  }

  move_stop(
    step: MapRouteStep,
    from_index: number,
    to_index: number,
  ): MapRouteStep {
    assert_index(from_index, step.stops.length);
    assert_index(to_index, step.stops.length);
    if (from_index === to_index) return step;
    const stops = [...step.stops];
    const [stop] = stops.splice(from_index, 1);
    stops.splice(to_index, 0, stop);
    return { ...step, stops: dedupe(stops) };
  }

  remove_stop(step: MapRouteStep, index: number): MapRouteStep | null {
    assert_index(index, step.stops.length);
    const stops = step.stops.filter((_, position) => position !== index);
    return stops.length === 0 ? null : { ...step, stops };
  }

  extract_stop(step: MapRouteStep, index: number): MapRouteSplit {
    assert_index(index, step.stops.length);
    const extracted: MapRouteStep = {
      label: null,
      stops: [step.stops[index]],
      travel_mode: step.travel_mode,
    };
    return { remaining: this.remove_stop(step, index), extracted };
  }

  set_label(step: MapRouteStep, label: string): MapRouteStep {
    const trimmed = label.trim();
    const derived = this.label({ ...step, label: null });
    return {
      ...step,
      label: trimmed === "" || trimmed === derived ? null : label,
    };
  }

  set_travel_mode(step: MapRouteStep, mode: TravelMode | null): MapRouteStep {
    return { ...step, travel_mode: mode };
  }

  warnings(step: MapRouteStep): readonly string[] {
    const warnings: string[] = [];
    const misplaced = step.stops.findIndex((stop, index) =>
      stop.point.kind === "current_location" && index > 0
    );
    if (misplaced > 0) {
      warnings.push(
        `${current_location_label} only works as the first stop; stop ${
          misplaced + 1
        } is left out of the generated route.`,
      );
    }
    if (!this.can_generate(step)) {
      warnings.push("Add a place: a route needs at least one destination.");
    }
    const waypoints = Math.max(0, step.stops.length - 2);
    if (waypoints > MAX_WAYPOINTS) {
      warnings.push(
        `Google Maps links carry at most ${MAX_WAYPOINTS} intermediate stops; the last ${
          waypoints - MAX_WAYPOINTS
        } are left out.`,
      );
    }
    return warnings;
  }
}

/** Default implementation used by the beta step editor. */
export const map_route_step_editor: MapRouteStepEditor =
  new DeterministicMapRouteStepEditor();

/**
 * True when a section is shown as a map frame instead of a plain link.
 *
 * `resolve` maps a stored URL to the canonical one a parser can read, which
 * is how an official short link becomes a frame once it has been expanded.
 * Without it only links that already address Maps are recognised.
 */
export function is_map_step_section(
  section: MarkdownSection,
  resolve: (url: string) => string | null = (url) => url,
): boolean {
  return map_step_of_section(section, resolve) !== null;
}

/**
 * A link that just became a map step starts as a list item.
 *
 * Only `became_map` triggers it: a link the reader already wrote as a plain
 * line keeps its own shape, and a list choice made afterwards is never undone.
 */
export function listed_map_draft(
  draft: MarkdownSectionDraft,
  became_map: boolean,
): MarkdownSectionDraft {
  return became_map && draft.type === "link" && draft.list_type === null
    ? section_editor.change_list_type(draft, default_map_list_type)
    : draft;
}

/** The frame behind a section, or `null` when it is not a map link. */
export function map_step_of_section(
  section: MarkdownSection,
  resolve: (url: string) => string | null = (url) => url,
): MapRouteStep | null {
  if (section.type !== "link") return null;
  const url = resolve(section.url);
  return url === null ? null : map_route_step_editor.read_link(
    section.label,
    url,
  );
}
