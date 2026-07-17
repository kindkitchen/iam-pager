/** A locator addresses one page: a namespace plus an optional page name. */
export interface Locator {
  /** Publisher-supplied spelling; identity is case-insensitive. */
  namespace: string;
  /**
   * Absent page name addresses the namespace's default page. A page name may
   * span many slugs; slugs are joined with "/".
   */
  page_name?: string;
}

/** Reasons a path cannot be mapped to a usable locator. */
export type LocatorResolutionError =
  /** The path does not address content at all (e.g. the site root). */
  | "not_a_locator"
  /** A path segment is malformed: bad encoding, dot segment, embedded slash. */
  | "invalid_segment"
  /** The namespace is reserved for the site or platform routes. */
  | "forbidden_namespace";

export type LocatorResolution =
  | { ok: true; locator: Locator }
  | { ok: false; reason: LocatorResolutionError };

/**
 * Case-insensitive identity key (DA-LOCATOR). Uniqueness and lookup use this
 * key; displayed values keep the publisher-supplied casing.
 */
export function locator_key(locator: Locator): string {
  const namespace = locator.namespace.toLowerCase();
  return locator.page_name === undefined
    ? namespace
    : `${namespace}/${locator.page_name.toLowerCase()}`;
}
