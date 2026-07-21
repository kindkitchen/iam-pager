import type { JSX } from "preact";
import { useState } from "preact/hooks";
import {
  namespace_reserved_event_type,
  type NamespacePanelReservation,
  type NamespaceReservedEventDetail,
} from "../lib/ui/namespace-panel.ts";

interface ReserveSuccess {
  ok: true;
  reservation: NamespacePanelReservation;
}

interface ReserveFailure {
  ok: false;
  error: string;
  detail: string;
}

type ReserveState =
  | { status: "idle" }
  | { status: "reserving" }
  | { status: "success"; namespace: string }
  | { status: "error"; message: string };

export interface NamespaceReservationPanelProps {
  /** Synchronizer token minted server-side for the authenticated session. */
  csrf_token: string;
  /** Server-rendered snapshot; successful reservations extend it in place. */
  initial_reservations: readonly NamespacePanelReservation[];
}

/** Creator panel for owned namespaces and reservation. */
export default function NamespaceReservationPanel(
  props: NamespaceReservationPanelProps,
) {
  const [reservations, set_reservations] = useState(props.initial_reservations);
  const [namespace, set_namespace] = useState("");
  const [state, set_state] = useState<ReserveState>({ status: "idle" });

  async function reserve(event: JSX.TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = namespace.trim();
    set_state({ status: "reserving" });
    try {
      const response = await fetch("/api/namespaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          namespace: trimmed,
          csrf_token: props.csrf_token,
        }),
      });
      const result = await response.json() as ReserveSuccess | ReserveFailure;
      if (!response.ok || !result.ok) {
        const message = result.ok
          ? `Reservation failed (${response.status})`
          : result.detail;
        set_state({ status: "error", message });
        return;
      }
      set_reservations((current) => [...current, result.reservation]);
      set_namespace("");
      set_state({ status: "success", namespace: result.reservation.namespace });
      globalThis.dispatchEvent(
        new CustomEvent<NamespaceReservedEventDetail>(
          namespace_reserved_event_type,
          { detail: { namespace: result.reservation.namespace } },
        ),
      );
    } catch (error) {
      set_state({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const is_reserving = state.status === "reserving";
  return (
    <section class="namespace-panel" aria-labelledby="namespace-heading">
      <div class="section-heading">
        <p class="eyebrow">Your namespaces</p>
        <h2 id="namespace-heading">Reserved namespaces</h2>
        <p>
          A reserved namespace is protected from guest and cross-creator
          overwrite; its pages stay under your control.
        </p>
      </div>

      {reservations.length === 0
        ? (
          <p class="namespace-empty">
            No reserved namespaces yet. Claim one below.
          </p>
        )
        : (
          <ul class="namespace-list">
            {reservations.map((reservation) => (
              <li key={reservation.namespace} class="namespace-item">
                <code>{reservation.path}</code>
                <span class="namespace-reserved-at">
                  reserved {reservation.reserved_at.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}

      <form class="namespace-form" onSubmit={reserve}>
        <label for="reserve-namespace">Namespace</label>
        <div class="namespace-form-row">
          <input
            id="reserve-namespace"
            name="namespace"
            required
            value={namespace}
            onInput={(event) => {
              set_namespace(event.currentTarget.value);
              if (state.status !== "idle" && state.status !== "reserving") {
                set_state({ status: "idle" });
              }
            }}
            placeholder="your-name"
            autocomplete="off"
          />
          <button type="submit" disabled={is_reserving}>
            {is_reserving ? "Reserving…" : "Reserve"}
          </button>
        </div>
      </form>

      <div class="namespace-result" aria-live="polite">
        {state.status === "success" && (
          <p>
            <strong>Namespace reserved.</strong> {state.namespace} is yours.
          </p>
        )}
        {state.status === "error" && (
          <p class="error-message">
            <strong>Could not reserve.</strong> {state.message}
          </p>
        )}
      </div>
    </section>
  );
}
