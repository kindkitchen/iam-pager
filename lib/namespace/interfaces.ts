import type { NamespaceReservation } from "./model.ts";

/** What a caller supplies to claim a namespace. */
export interface ReserveRequest {
  /** Spelling to preserve; identity is its case-insensitive key. */
  namespace: string;
  owner_user_id: string;
}

export type ReserveResult =
  | { ok: true; reservation: NamespaceReservation }
  /** The namespace is already reserved (case-insensitively). */
  | { ok: false; reason: "taken" };

/**
 * Storage contract for namespace reservations (DA-NAMESPACE).
 *
 * Identity and atomicity rules every implementation must satisfy:
 *
 * - Identity is the case-insensitive `namespace_key`; the supplied casing is
 *   preserved and returned unchanged.
 * - `reserve` is atomic: under concurrent attempts for the same
 *   case-insensitive namespace exactly one caller wins; every other caller
 *   gets the typed `taken` result. A reservation is never silently replaced.
 * - `reserved_at` is stamped by the implementation at reserve time.
 *
 * Namespace validity (which strings may be reserved) is not this layer's
 * concern: the reservation service validates through the locator engine so
 * reservation and publishing rules can never diverge. Implementations treat
 * the namespace string as opaque apart from case-insensitive keying.
 *
 * Conformance for these rules is `test_namespace_repository_conformance`;
 * any backend (memory today, durable later) must pass it unchanged.
 */
export interface NamespaceRepository {
  /** Atomically claim a free namespace for an owner. */
  reserve(request: ReserveRequest): Promise<ReserveResult>;
  /** Case-insensitive lookup; null when the namespace is unreserved. */
  find(namespace: string): Promise<NamespaceReservation | null>;
  /** Every reservation owned by the user; order is unspecified. */
  list_by_owner(owner_user_id: string): Promise<NamespaceReservation[]>;
}
