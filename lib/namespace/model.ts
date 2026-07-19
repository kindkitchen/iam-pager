import { locator_key } from "../locator/model.ts";

/** A creator's exclusive claim on a namespace (DA-NAMESPACE). */
export interface NamespaceReservation {
  /** Publisher-supplied spelling; identity is case-insensitive. */
  namespace: string;
  /** The authenticated user that owns the namespace. */
  owner_user_id: string;
  /** When the reservation was recorded, stamped by the repository. */
  reserved_at: Date;
}

/**
 * Case-insensitive identity key for a namespace. Derived through the locator
 * model's key so reservation identity can never diverge from locator
 * identity (DA-NAMESPACE, DA-LOCATOR): a namespace is reserved exactly when
 * locators under it match it.
 */
export function namespace_key(namespace: string): string {
  return locator_key({ namespace });
}

/**
 * Stable public order for owned reservations — oldest first, then spelling —
 * so API responses and site panels never depend on repository iteration.
 */
export function sort_reservations(
  reservations: readonly NamespaceReservation[],
): NamespaceReservation[] {
  return [...reservations].sort((left, right) =>
    left.reserved_at.getTime() - right.reserved_at.getTime() ||
    compare_text(namespace_key(left.namespace), namespace_key(right.namespace))
  );
}

/** Locale-independent ordering keeps API output identical across runtimes. */
function compare_text(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
