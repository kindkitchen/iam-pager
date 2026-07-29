import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import type { TravelMode } from "../lib/maps/model.ts";
import {
  is_short_map_link,
  type MapLinkResolver,
  RemoteMapLinkResolver,
} from "../lib/ui/map-link-resolver.ts";
import {
  map_route_step_editor,
  type MapRouteStep,
  travel_modes,
} from "../lib/ui/map-route-steps.ts";
import { GoogleMapsPin } from "./GoogleMapsPin.tsx";

export interface MapRouteFieldsProps {
  readonly step: MapRouteStep;
  readonly id_prefix: string;
  readonly on_change: (step: MapRouteStep) => void;
  /** Offered when the surface can host the stop as its own step. */
  readonly on_split_stop?: (index: number) => void;
  readonly on_message?: (message: string) => void;
  /** Expansion of official short links; shared with the surrounding editor. */
  readonly resolver?: MapLinkResolver;
}

const steps_editor = map_route_step_editor;
const default_resolver = new RemoteMapLinkResolver();

interface StopDrag {
  readonly from_index: number;
  readonly to_index: number;
  readonly pointer_id: number;
}

function DragGrip() {
  return (
    <svg viewBox="0 0 16 24" aria-hidden="true" focusable="false">
      {[4, 12].map((x) =>
        [4, 12, 20].map((y) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" />
        ))
      )}
    </svg>
  );
}

/**
 * Stop frame of a map link: the ordered stops behind one `[label](url)` pair.
 *
 * Every edit rewrites the link through `lib/maps`, so the document never holds
 * anything but a Markdown link, and the route always follows the visible
 * top-to-bottom order.
 */
export function MapRouteFields(props: MapRouteFieldsProps) {
  const { step } = props;
  const [value, set_value] = useState("");
  const [pending, set_pending] = useState(false);
  const [drag, set_drag] = useState<StopDrag | null>(null);
  const drag_ref = useRef<StopDrag | null>(null);
  const handle_ref = useRef<HTMLButtonElement | null>(null);
  const list_ref = useRef<HTMLOListElement>(null);

  const warnings = steps_editor.warnings(step);
  const url = steps_editor.can_generate(step) ? steps_editor.url(step) : "";

  function announce(message: string) {
    props.on_message?.(message);
  }

  function update_drag(next: StopDrag | null) {
    drag_ref.current = next;
    set_drag(next);
  }

  function begin_drag(
    event: JSX.TargetedPointerEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.button !== 0 || step.stops.length < 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    handle_ref.current = event.currentTarget;
    update_drag({
      from_index: index,
      to_index: index,
      pointer_id: event.pointerId,
    });
  }

  function drag_stop(event: JSX.TargetedPointerEvent<HTMLButtonElement>) {
    const current = drag_ref.current;
    if (!current || current.pointer_id !== event.pointerId) return;
    event.preventDefault();
    const elements = Array.from(
      list_ref.current?.querySelectorAll<HTMLElement>(
        "[data-map-stop-index]",
      ) ??
        [],
    );
    let to_index = elements.length - 1;
    for (const element of elements) {
      const bounds = element.getBoundingClientRect();
      if (event.clientY <= bounds.bottom) {
        to_index = Number(element.dataset.mapStopIndex);
        break;
      }
    }
    if (to_index !== current.to_index) update_drag({ ...current, to_index });
  }

  function finish_drag(event: JSX.TargetedPointerEvent<HTMLButtonElement>) {
    const current = drag_ref.current;
    if (!current || current.pointer_id !== event.pointerId) return;
    try {
      handle_ref.current?.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may have released the capture already.
    }
    handle_ref.current = null;
    update_drag(null);
    if (current.from_index === current.to_index) return;
    props.on_change(
      steps_editor.move_stop(step, current.from_index, current.to_index),
    );
    announce(
      `Stop ${current.from_index + 1} is now stop ${current.to_index + 1}.`,
    );
  }

  function cancel_drag(event: JSX.TargetedPointerEvent<HTMLButtonElement>) {
    const current = drag_ref.current;
    if (!current || current.pointer_id !== event.pointerId) return;
    handle_ref.current = null;
    update_drag(null);
  }

  function keyboard_move(
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let to_index = index;
    if (event.key === "ArrowUp") to_index = Math.max(0, index - 1);
    else if (event.key === "ArrowDown") {
      to_index = Math.min(step.stops.length - 1, index + 1);
    } else return;
    event.preventDefault();
    if (to_index === index) return;
    props.on_change(steps_editor.move_stop(step, index, to_index));
    announce(`Stop ${index + 1} is now stop ${to_index + 1}.`);
  }

  function remove_stop(index: number) {
    const next = steps_editor.remove_stop(step, index);
    if (!next || !steps_editor.can_generate(next)) {
      announce("A route keeps at least one place; this stop stays.");
      return;
    }
    props.on_change(next);
    announce(`Removed stop ${index + 1}.`);
  }

  async function add_stop() {
    const trimmed = value.trim();
    if (trimmed === "") return;
    const direct = steps_editor.stops_from_value(trimmed);
    if (direct.length > 0) {
      props.on_change(steps_editor.add_stops(step, direct));
      set_value("");
      announce("Added a stop at the end of the route.");
      return;
    }

    // An alias carries no place of its own: the site follows the redirect,
    // and the shared resolver answers a repeated paste from memory.
    if (!is_short_map_link(trimmed)) {
      announce("That is not a Google Maps place or route link.");
      return;
    }
    set_pending(true);
    try {
      const expanded = await (props.resolver ?? default_resolver).resolve(
        trimmed,
      );
      const stops = expanded === null
        ? []
        : steps_editor.stops_from_value(expanded);
      if (stops.length === 0) {
        announce("The short link could not be expanded.");
        return;
      }
      props.on_change(steps_editor.add_stops(step, stops));
      set_value("");
      announce("Expanded the short link and added its stops.");
    } finally {
      set_pending(false);
    }
  }

  return (
    <div class="map-route-fields">
      <div class="map-route-heading">
        <GoogleMapsPin title="Google Maps route" />
        <strong>Stops</strong>
        <label
          class="map-route-current-location"
          for={`${props.id_prefix}-current-location`}
        >
          <input
            id={`${props.id_prefix}-current-location`}
            type="checkbox"
            checked={steps_editor.has_current_location(step)}
            onChange={() => {
              const next = steps_editor.toggle_current_location(step);
              props.on_change(next);
              announce(
                steps_editor.has_current_location(next)
                  ? "Your location starts the route."
                  : "Your location no longer starts the route.",
              );
            }}
          />
          <span>Start from your location</span>
        </label>
      </div>

      <ol class="map-route-stops" ref={list_ref}>
        {step.stops.map((stop, index) => (
          <li
            key={`${index}:${stop.label}`}
            class="map-route-stop"
            data-map-stop-index={index}
            data-kind={stop.point.kind}
            data-dragging={drag?.from_index === index}
            data-drop-target={drag !== null && drag.to_index === index &&
              drag.from_index !== index}
          >
            <button
              type="button"
              class="map-route-stop-grip compact-button"
              aria-label={`Drag stop ${index + 1}`}
              title="Drag to reorder; arrow keys work when focused"
              disabled={step.stops.length < 2}
              onPointerDown={(event) => begin_drag(event, index)}
              onPointerMove={drag_stop}
              onPointerUp={finish_drag}
              onPointerCancel={cancel_drag}
              onKeyDown={(event) => keyboard_move(event, index)}
            >
              <DragGrip />
            </button>
            <span class="map-route-stop-order">{index + 1}</span>
            <span class="map-route-stop-label">{stop.label}</span>
            <span class="map-route-stop-role">
              {index === 0
                ? "Origin"
                : index === step.stops.length - 1
                ? "Destination"
                : "Stop"}
            </span>
            {props.on_split_stop && (
              <button
                type="button"
                class="compact-button"
                disabled={step.stops.length < 2 ||
                  stop.point.kind === "current_location"}
                onClick={() => props.on_split_stop?.(index)}
              >
                Split out
              </button>
            )}
            <button
              type="button"
              class="compact-button"
              aria-label={`Remove stop ${index + 1}`}
              onClick={() => remove_stop(index)}
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      <div class="map-route-controls">
        <label for={`${props.id_prefix}-travel-mode`}>
          Travel mode
          <select
            id={`${props.id_prefix}-travel-mode`}
            value={step.travel_mode ?? ""}
            onChange={(event) =>
              props.on_change(
                steps_editor.set_travel_mode(
                  step,
                  event.currentTarget.value === ""
                    ? null
                    : event.currentTarget.value as TravelMode,
                ),
              )}
          >
            <option value="">Maps default</option>
            {travel_modes.map((mode) => (
              <option value={mode} key={mode}>{mode}</option>
            ))}
          </select>
        </label>
        <label class="map-route-add-stop" for={`${props.id_prefix}-add-stop`}>
          Add stop
          <input
            id={`${props.id_prefix}-add-stop`}
            type="text"
            value={value}
            placeholder="Maps link, address, or 50.45,30.52"
            onInput={(event) => set_value(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          class="compact-button"
          disabled={pending || value.trim() === ""}
          onClick={add_stop}
        >
          {pending ? "Resolving…" : "Add"}
        </button>
        {url !== "" && (
          <a
            class="map-route-open"
            href={url}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open route
          </a>
        )}
      </div>

      {warnings.map((warning) => (
        <small class="map-route-warning" role="status" key={warning}>
          {warning}
        </small>
      ))}
    </div>
  );
}
