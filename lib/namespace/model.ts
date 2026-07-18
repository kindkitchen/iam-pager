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
