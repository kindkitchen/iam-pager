import type {
  NamespaceRepository,
  ReserveRequest,
  ReserveResult,
} from "./interfaces.ts";
import { namespace_key, type NamespaceReservation } from "./model.ts";

/**
 * Map-backed reservations keyed by `namespace_key`; supplied casing lives in
 * the stored record. Atomicity holds because the check-then-set in `reserve`
 * runs synchronously with no await between check and set, so overlapping
 * calls serialize on the event loop and exactly one wins.
 */
export class MemoryNamespaceRepository implements NamespaceRepository {
  #reservations = new Map<string, NamespaceReservation>();
  readonly #now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  reserve(request: ReserveRequest): Promise<ReserveResult> {
    const key = namespace_key(request.namespace);
    if (this.#reservations.has(key)) {
      return Promise.resolve({ ok: false, reason: "taken" });
    }
    const reservation: NamespaceReservation = {
      namespace: request.namespace,
      owner_user_id: request.owner_user_id,
      reserved_at: this.#now(),
    };
    this.#reservations.set(key, reservation);
    return Promise.resolve({ ok: true, reservation });
  }

  find(namespace: string): Promise<NamespaceReservation | null> {
    return Promise.resolve(
      this.#reservations.get(namespace_key(namespace)) ?? null,
    );
  }

  list_by_owner(owner_user_id: string): Promise<NamespaceReservation[]> {
    return Promise.resolve(
      [...this.#reservations.values()].filter(
        (reservation) => reservation.owner_user_id === owner_user_id,
      ),
    );
  }
}
