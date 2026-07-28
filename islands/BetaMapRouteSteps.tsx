import type { JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import { GoogleMapsPin } from "../components/GoogleMapsPin.tsx";
import type { TravelMode } from "../lib/maps/model.ts";
import { parse_google_maps_url } from "../lib/maps/parse.ts";
import {
  map_route_step_editor,
  type MapRouteStep,
  type MapRouteStop,
  travel_modes,
} from "../lib/ui/map-route-steps.ts";
import {
  DeterministicMarkdownSectionEditor,
  type MarkdownSection,
} from "../lib/ui/markdown-section-editor.ts";

export interface BetaMapRouteStepsProps {
  readonly initial_markdown: string;
  /** Endpoint that expands official Google short links. */
  readonly expand_endpoint: string;
}

/** Where a pointer drag would drop. */
type DropTarget =
  /** Between steps: insert position in the step list. */
  | { readonly type: "move"; readonly index: number }
  /** Into the map frame at this step index. */
  | { readonly type: "frame"; readonly index: number }
  /** Inside the dragged stop's own frame: insert position in the stop list. */
  | { readonly type: "stop"; readonly index: number };

/** What the pointer picked up, before the pointer id is attached. */
type DragIntent =
  | {
    readonly kind: "step";
    readonly from_index: number;
    readonly target: DropTarget;
  }
  | {
    readonly kind: "stop";
    readonly step_index: number;
    readonly stop_index: number;
    readonly target: DropTarget;
  };

type Dragging = DragIntent & { readonly pointer_id: number };

const section_editor = new DeterministicMarkdownSectionEditor();
const steps_editor = map_route_step_editor;

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

/** Where a pointer sits relative to a list: a gap, or the body of one item. */
interface PointerSlot {
  readonly index: number;
  readonly inside: boolean;
}

function slot_at(
  elements: readonly HTMLElement[],
  attribute: "betaStepIndex" | "betaStopIndex",
  client_y: number,
  end_index: number,
): PointerSlot {
  for (const element of elements) {
    const bounds = element.getBoundingClientRect();
    const index = Number(element.dataset[attribute]);
    const edge = Math.min(28, bounds.height * 0.3);
    if (client_y < bounds.top + edge) return { index, inside: false };
    if (client_y <= bounds.bottom - edge) return { index, inside: true };
    if (client_y <= bounds.bottom) return { index: index + 1, inside: false };
  }
  return { index: end_index, inside: false };
}

/**
 * Beta step editor for map links: every step stays a Markdown link, while map
 * links are shown as a frame of ordered stops. Dropping one frame on another
 * joins their stops instead of merging text, and the route link is rebuilt
 * from the top-to-bottom order.
 */
export default function BetaMapRouteSteps(props: BetaMapRouteStepsProps) {
  const [markdown, set_markdown] = useState(props.initial_markdown);
  const [dragging, set_dragging] = useState<Dragging | null>(null);
  const [message, set_message] = useState("");
  const [new_value, set_new_value] = useState("");
  const [stop_values, set_stop_values] = useState<Record<number, string>>({});
  const [pending, set_pending] = useState(false);
  const dragging_ref = useRef<Dragging | null>(null);
  const handle_ref = useRef<HTMLButtonElement | null>(null);

  const sections = useMemo(() => section_editor.parse(markdown), [markdown]);
  const steps = useMemo(
    () => sections.map((section) => steps_editor.read(section)),
    [sections],
  );

  function commit(next: readonly MarkdownSection[]) {
    set_markdown(section_editor.serialize(next));
  }

  function replace(index: number, step: MapRouteStep) {
    const next = [...sections];
    next[index] = steps_editor.section(step, sections[index]);
    commit(next);
  }

  function move_step(from_index: number, to_index: number) {
    if (from_index === to_index) return;
    commit(section_editor.move(sections, from_index, to_index));
    set_message(`Moved step ${from_index + 1} to position ${to_index + 1}.`);
  }

  function merge_steps(from_index: number, into_index: number) {
    const source = steps[from_index];
    const target = steps[into_index];
    if (!source || !target) return;
    const next = [...sections];
    next[into_index] = steps_editor.section(
      steps_editor.merge(target, source),
      sections[into_index],
    );
    next.splice(from_index, 1);
    commit(next);
    set_message(
      `Framed step ${from_index + 1} into step ${into_index + 1} as stops.`,
    );
  }

  function move_stop(step_index: number, from_index: number, to_index: number) {
    const step = steps[step_index];
    if (!step || from_index === to_index) return;
    replace(step_index, steps_editor.move_stop(step, from_index, to_index));
    set_message(`Stop ${from_index + 1} is now stop ${to_index + 1}.`);
  }

  function split_stop(
    step_index: number,
    stop_index: number,
    insert_index: number,
  ) {
    const step = steps[step_index];
    if (!step) return;
    if (step.stops.length < 2) {
      set_message("A frame keeps its last stop; drag the whole step instead.");
      return;
    }
    const { remaining, extracted } = steps_editor.extract_stop(
      step,
      stop_index,
    );
    if (!steps_editor.can_generate(extracted)) {
      set_message("Your location cannot stand alone as a step.");
      return;
    }
    const keep = remaining !== null && steps_editor.can_generate(remaining);
    const next = [...sections];
    if (keep) {
      next[step_index] = steps_editor.section(remaining!, sections[step_index]);
    }
    let position = insert_index;
    if (!keep) {
      next.splice(step_index, 1);
      if (position > step_index) position -= 1;
    }
    next.splice(
      Math.max(0, Math.min(position, next.length)),
      0,
      steps_editor.section(extracted),
    );
    commit(next);
    set_message(`Stop ${stop_index + 1} left the frame as its own step.`);
  }

  function move_stop_to_step(
    source_index: number,
    stop_index: number,
    target_index: number,
  ) {
    const source = steps[source_index];
    const target = steps[target_index];
    if (!source || !target || source_index === target_index) return;
    const { remaining, extracted } = steps_editor.extract_stop(
      source,
      stop_index,
    );
    const next = [...sections];
    next[target_index] = steps_editor.section(
      steps_editor.merge(target, extracted),
      sections[target_index],
    );
    if (remaining !== null && steps_editor.can_generate(remaining)) {
      next[source_index] = steps_editor.section(
        remaining,
        sections[source_index],
      );
    } else {
      next.splice(source_index, 1);
    }
    commit(next);
    set_message(`Stop ${stop_index + 1} joined step ${target_index + 1}.`);
  }

  function remove_stop(step_index: number, stop_index: number) {
    const step = steps[step_index];
    if (!step) return;
    const next_step = steps_editor.remove_stop(step, stop_index);
    const next = [...sections];
    if (next_step && steps_editor.can_generate(next_step)) {
      next[step_index] = steps_editor.section(next_step, sections[step_index]);
    } else {
      next.splice(step_index, 1);
    }
    commit(next);
    set_message(`Removed stop ${stop_index + 1}.`);
  }

  function remove_step(index: number) {
    commit(section_editor.remove(sections, index));
    set_message(`Removed step ${index + 1}.`);
  }

  /** Resolves pasted text, asking the site to expand official short links. */
  async function stops_of(value: string): Promise<readonly MapRouteStop[]> {
    const direct = steps_editor.stops_from_value(value);
    if (direct.length > 0) return direct;
    const link = parse_google_maps_url(value);
    if (link.kind !== "short_link") {
      set_message("That is not a Google Maps place or route link.");
      return [];
    }
    set_pending(true);
    try {
      const response = await fetch(props.expand_endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: link.url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.url !== "string") {
        set_message("The short link could not be expanded.");
        return [];
      }
      return steps_editor.stops_from_value(data.url);
    } catch {
      set_message("The short link could not be expanded.");
      return [];
    } finally {
      set_pending(false);
    }
  }

  async function add_step() {
    const stops = await stops_of(new_value);
    if (stops.length === 0) return;
    const step: MapRouteStep = { label: null, stops, travel_mode: null };
    commit([...sections, steps_editor.section(step)]);
    set_new_value("");
    set_message("Added a map step. Drag its grip onto another to frame them.");
  }

  async function add_stop(step_index: number) {
    const step = steps[step_index];
    const value = stop_values[step_index] ?? "";
    if (!step || value.trim() === "") return;
    const stops = await stops_of(value);
    if (stops.length === 0) return;
    replace(step_index, steps_editor.add_stops(step, stops));
    set_stop_values({ ...stop_values, [step_index]: "" });
    set_message("Added a stop at the end of the frame.");
  }

  function update_dragging(next: Dragging | null) {
    dragging_ref.current = next;
    set_dragging(next);
  }

  function begin_drag(
    event: JSX.TargetedPointerEvent<HTMLButtonElement>,
    intent: DragIntent,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    handle_ref.current = event.currentTarget;
    update_dragging({ ...intent, pointer_id: event.pointerId });
  }

  function drag(event: JSX.TargetedPointerEvent<HTMLButtonElement>) {
    const current = dragging_ref.current;
    if (!current || current.pointer_id !== event.pointerId) return;
    event.preventDefault();
    const document = globalThis.document;
    const step_elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-beta-step-index]"),
    );

    // A map step dropped on the body of another map step becomes its stops;
    // anything else is a plain reorder.
    function step_target(source_index: number): DropTarget {
      const slot = slot_at(
        step_elements,
        "betaStepIndex",
        event.clientY,
        sections.length,
      );
      if (!slot.inside) return { type: "move", index: slot.index };
      const frameable = slot.index !== source_index &&
        steps[slot.index] !== null;
      return frameable
        ? { type: "frame", index: slot.index }
        : { type: "move", index: slot.index + 1 };
    }

    let target: DropTarget;
    if (current.kind === "step") {
      if (steps[current.from_index] === null) {
        // A plain step cannot frame anything: its body is a drop gap too.
        const slot = slot_at(
          step_elements,
          "betaStepIndex",
          event.clientY,
          sections.length,
        );
        target = {
          type: "move",
          index: slot.inside ? slot.index + 1 : slot.index,
        };
      } else target = step_target(current.from_index);
    } else {
      const frame = step_elements.find((element) =>
        Number(element.dataset.betaStepIndex) === current.step_index
      );
      const bounds = frame?.getBoundingClientRect();
      if (
        frame && bounds && event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom
      ) {
        const stop_elements = Array.from(
          frame.querySelectorAll<HTMLElement>("[data-beta-stop-index]"),
        );
        const slot = slot_at(
          stop_elements,
          "betaStopIndex",
          event.clientY,
          stop_elements.length,
        );
        target = {
          type: "stop",
          index: slot.inside ? slot.index + 1 : slot.index,
        };
      } else {
        target = step_target(current.step_index);
      }
    }

    if (
      target.type !== current.target.type ||
      target.index !== current.target.index
    ) {
      update_dragging({ ...current, target });
    }
    if (event.clientY < 72) globalThis.scrollBy({ top: -24 });
    else if (event.clientY > globalThis.innerHeight - 72) {
      globalThis.scrollBy({ top: 24 });
    }
  }

  function finish_drag(event: JSX.TargetedPointerEvent<HTMLButtonElement>) {
    const current = dragging_ref.current;
    if (!current || current.pointer_id !== event.pointerId) return;
    try {
      handle_ref.current?.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may have released the capture already.
    }
    handle_ref.current = null;
    update_dragging(null);

    const target = current.target;
    if (current.kind === "step") {
      if (target.type === "frame") {
        merge_steps(current.from_index, target.index);
      } else if (target.type === "move") {
        move_step(
          current.from_index,
          target.index > current.from_index ? target.index - 1 : target.index,
        );
      }
      return;
    }
    if (target.type === "stop") {
      move_stop(
        current.step_index,
        current.stop_index,
        target.index > current.stop_index ? target.index - 1 : target.index,
      );
    } else if (target.type === "frame") {
      move_stop_to_step(current.step_index, current.stop_index, target.index);
    } else {
      split_stop(current.step_index, current.stop_index, target.index);
    }
  }

  function cancel_drag(event: JSX.TargetedPointerEvent<HTMLButtonElement>) {
    const current = dragging_ref.current;
    if (!current || current.pointer_id !== event.pointerId) return;
    handle_ref.current = null;
    update_dragging(null);
    set_message("Canceled the drag.");
  }

  function step_keys(
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowUp") move_step(index, Math.max(0, index - 1));
    else if (event.key === "ArrowDown") {
      move_step(index, Math.min(sections.length - 1, index + 1));
    } else return;
    event.preventDefault();
  }

  function stop_keys(
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>,
    step_index: number,
    stop_index: number,
  ) {
    const step = steps[step_index];
    if (!step) return;
    if (event.key === "ArrowUp") {
      move_stop(step_index, stop_index, Math.max(0, stop_index - 1));
    } else if (event.key === "ArrowDown") {
      move_stop(
        step_index,
        stop_index,
        Math.min(step.stops.length - 1, stop_index + 1),
      );
    } else return;
    event.preventDefault();
  }

  return (
    <section class="beta-map-steps">
      <ol class="beta-steps" aria-label="Markdown steps">
        {sections.map((section, index) => {
          const step = steps[index];
          const url = step && steps_editor.can_generate(step)
            ? steps_editor.url(step)
            : "";
          const warnings = step ? steps_editor.warnings(step) : [];
          return (
            <li
              key={`${index}:${section.raw}`}
              class={step ? "beta-step beta-map-step" : "beta-step"}
              data-beta-step-index={index}
              data-drop-before={dragging?.target.type === "move" &&
                dragging.target.index === index}
              data-drop-into={dragging?.target.type === "frame" &&
                dragging.target.index === index}
              data-dragging={dragging?.kind === "step" &&
                dragging.from_index === index}
            >
              <div class="beta-step-head">
                <button
                  type="button"
                  class="beta-grip"
                  aria-label={`Drag step ${index + 1}`}
                  title="Drag between steps to reorder, or onto another map step to frame them as stops"
                  onPointerDown={(event) =>
                    begin_drag(event, {
                      kind: "step",
                      from_index: index,
                      target: { type: "move", index },
                    })}
                  onPointerMove={drag}
                  onPointerUp={finish_drag}
                  onPointerCancel={cancel_drag}
                  onKeyDown={(event) => step_keys(event, index)}
                >
                  <DragGrip />
                </button>
                {step
                  ? (
                    <>
                      <GoogleMapsPin title="Google Maps route" />
                      <input
                        class="beta-step-label"
                        aria-label={`Label of step ${index + 1}`}
                        value={steps_editor.label(step)}
                        onInput={(event) =>
                          replace(
                            index,
                            steps_editor.set_label(
                              step,
                              event.currentTarget.value,
                            ),
                          )}
                      />
                    </>
                  )
                  : (
                    <span class="beta-step-raw">{section.raw || "\u00a0"}</span>
                  )}
                <button
                  type="button"
                  class="beta-step-remove"
                  aria-label={`Remove step ${index + 1}`}
                  onClick={() => remove_step(index)}
                >
                  ×
                </button>
              </div>

              {step && (
                <>
                  <ol
                    class="beta-stops"
                    aria-label={`Stops of step ${index + 1}`}
                  >
                    {step.stops.map((stop, stop_index) => (
                      <li
                        key={`${stop_index}:${stop.label}`}
                        class="beta-stop"
                        data-beta-stop-index={stop_index}
                        data-kind={stop.point.kind}
                        data-drop-before={dragging?.kind === "stop" &&
                          dragging.step_index === index &&
                          dragging.target.type === "stop" &&
                          dragging.target.index === stop_index}
                        data-dragging={dragging?.kind === "stop" &&
                          dragging.step_index === index &&
                          dragging.stop_index === stop_index}
                      >
                        <button
                          type="button"
                          class="beta-grip beta-stop-grip"
                          aria-label={`Drag stop ${stop_index + 1} of step ${
                            index + 1
                          }`}
                          title="Drag inside the frame to reorder, outside to split it into its own step"
                          onPointerDown={(event) =>
                            begin_drag(event, {
                              kind: "stop",
                              step_index: index,
                              stop_index,
                              target: { type: "stop", index: stop_index },
                            })}
                          onPointerMove={drag}
                          onPointerUp={finish_drag}
                          onPointerCancel={cancel_drag}
                          onKeyDown={(event) =>
                            stop_keys(event, index, stop_index)}
                        >
                          <DragGrip />
                        </button>
                        <span class="beta-stop-order">{stop_index + 1}</span>
                        <span class="beta-stop-label">{stop.label}</span>
                        <span class="beta-stop-role">
                          {stop_index === 0
                            ? "Origin"
                            : stop_index === step.stops.length - 1
                            ? "Destination"
                            : "Stop"}
                        </span>
                        <button
                          type="button"
                          class="beta-stop-action"
                          disabled={step.stops.length < 2}
                          onClick={() =>
                            split_stop(index, stop_index, index + 1)}
                        >
                          Split out
                        </button>
                        <button
                          type="button"
                          class="beta-stop-action"
                          aria-label={`Remove stop ${stop_index + 1}`}
                          onClick={() => remove_stop(index, stop_index)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ol>

                  <div class="beta-frame-footer">
                    <label class="beta-travel-mode">
                      Travel mode
                      <select
                        value={step.travel_mode ?? ""}
                        onChange={(event) =>
                          replace(
                            index,
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
                          <option value={mode}>{mode}</option>
                        ))}
                      </select>
                    </label>
                    <label class="beta-add-stop">
                      Add stop
                      <input
                        value={stop_values[index] ?? ""}
                        placeholder="Paste a Maps link, address, or lat,lng"
                        onInput={(event) =>
                          set_stop_values({
                            ...stop_values,
                            [index]: event.currentTarget.value,
                          })}
                      />
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => add_stop(index)}
                      >
                        Add
                      </button>
                    </label>
                    {url !== "" && (
                      <a
                        class="beta-open-route"
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Open route
                      </a>
                    )}
                  </div>
                  {warnings.map((warning) => (
                    <p class="beta-warning" role="status">{warning}</p>
                  ))}
                </>
              )}
            </li>
          );
        })}
        {dragging && (
          <li
            class="beta-drop-end"
            data-active={dragging.target.type === "move" &&
              dragging.target.index === sections.length}
          >
            Drop at end
          </li>
        )}
      </ol>

      <div class="beta-add-step">
        <label>
          New map step
          <input
            value={new_value}
            placeholder="https://maps.app.goo.gl/… or a place, or 50.45,30.52"
            onInput={(event) => set_new_value(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          disabled={pending || new_value.trim() === ""}
          onClick={add_step}
        >
          {pending ? "Resolving…" : "Add map step"}
        </button>
      </div>

      <p class="beta-message" role="status" aria-live="polite">{message}</p>

      <label class="beta-markdown">
        Markdown
        <textarea
          rows={8}
          value={markdown}
          spellcheck={false}
          onInput={(event) => set_markdown(event.currentTarget.value)}
        />
      </label>
    </section>
  );
}
