import type { LocatorEngine } from "../locator/mod.ts";
import type { NamespaceReservationManager } from "../namespace/interfaces.ts";
import { sort_reservations } from "../namespace/model.ts";
import type { Session } from "../session/model.ts";

/** Serializable reservation view rendered by the site panel and island. */
export interface NamespacePanelReservation {
  readonly namespace: string;
  /** Public direct path built by the locator engine for display or navigation. */
  readonly path: string;
  /** ISO timestamp; islands receive it across the serialization boundary. */
  readonly reserved_at: string;
}

/** Complete server-owned model for the creator namespace panel. */
export type NamespacePanel =
  | { readonly kind: "hidden" }
  | {
    readonly kind: "creator";
    /** Synchronizer token the reserve form must send back to the API. */
    readonly csrf_token: string;
    readonly reservations: readonly NamespacePanelReservation[];
  };

export interface NamespacePanelPresenter {
  present(session: Session): Promise<NamespacePanel>;
}

export interface CreatorNamespacePanelPresenterOptions {
  readonly namespaces: NamespaceReservationManager;
  readonly engine: LocatorEngine;
}

/**
 * Keeps session decisions, reservation loading, and path building outside UI
 * components: guests get a hidden panel, creators get trusted form inputs and
 * already-formatted direct paths (DS-PROTECT).
 */
export class CreatorNamespacePanelPresenter implements NamespacePanelPresenter {
  readonly #namespaces: NamespaceReservationManager;
  readonly #engine: LocatorEngine;

  constructor(options: CreatorNamespacePanelPresenterOptions) {
    this.#namespaces = options.namespaces;
    this.#engine = options.engine;
  }

  async present(session: Session): Promise<NamespacePanel> {
    if (session.kind !== "authenticated") return { kind: "hidden" };
    const owned = await this.#namespaces.list_owned(session.user_id);
    return {
      kind: "creator",
      csrf_token: session.csrf_token,
      reservations: sort_reservations(owned).map((reservation) => ({
        namespace: reservation.namespace,
        path: this.#engine.format({ namespace: reservation.namespace }),
        reserved_at: reservation.reserved_at.toISOString(),
      })),
    };
  }
}
