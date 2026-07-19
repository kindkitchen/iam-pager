import type { LocatorEngine } from "../locator/engine.ts";
import type {
  NamespaceRepository,
  NamespaceReservationManager,
  ReserveNamespaceResult,
  ReserveRequest,
} from "./interfaces.ts";
import type { NamespaceReservation } from "./model.ts";

export interface NamespaceReservationServiceOptions {
  /** Sole authority on namespace validity (forbidden and malformed names). */
  engine: LocatorEngine;
  repository: NamespaceRepository;
}

/**
 * The reserve/list use-cases on top of the locator and namespace layers
 * (DA-NAMESPACE, CP-NAMESPACE).
 *
 * Validity is delegated to the locator engine by validating the
 * namespace-only locator, so exactly the namespaces that locators can
 * address are reservable: forbidden namespaces are rejected as
 * `forbidden_namespace`, malformed ones as `invalid_namespace`. Atomicity
 * and case-insensitive identity stay in the repository contract; this layer
 * adds no storage rules of its own.
 */
export class NamespaceReservationService
  implements NamespaceReservationManager {
  #engine: LocatorEngine;
  #repository: NamespaceRepository;

  constructor(options: NamespaceReservationServiceOptions) {
    this.#engine = options.engine;
    this.#repository = options.repository;
  }

  async reserve(request: ReserveRequest): Promise<ReserveNamespaceResult> {
    const validation = this.#engine.validate({
      namespace: request.namespace,
    });
    if (!validation.ok) {
      return validation.reason === "forbidden_namespace"
        ? { ok: false, reason: "forbidden_namespace" }
        : { ok: false, reason: "invalid_namespace" };
    }
    const reserved = await this.#repository.reserve(request);
    if (!reserved.ok) return { ok: false, reason: "taken" };
    return { ok: true, reservation: reserved.reservation };
  }

  list_owned(owner_user_id: string): Promise<NamespaceReservation[]> {
    return this.#repository.list_by_owner(owner_user_id);
  }
}
