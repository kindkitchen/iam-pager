import {
  type ContentAssetId,
  is_valid_content_asset_id,
} from "../content/asset.ts";
import type { PageEndpointBinding, PageEndpointSet } from "./endpoint.ts";

export const external_content_missing_causes = [
  "external_content_missing",
  "connection_revoked",
  "integrity_mismatch",
] as const;

export type ExternalContentMissingCause =
  (typeof external_content_missing_causes)[number];

/** Owner-observable delivery health; it does not change page revision semantics. */
export interface ExternalContentMissingState {
  readonly cause: ExternalContentMissingCause;
  readonly detected_at: Date;
}
import { page_endpoint_set_violation } from "./endpoint.ts";
import {
  is_valid_page_access,
  is_valid_page_id,
  is_valid_page_revision,
  is_valid_page_tags,
  type PageAccess,
  type PageId,
  type PageStewardship,
  type PageTag,
} from "./model.ts";

/**
 * One logical page independent of content bytes and endpoint indexes. The
 * canonical endpoint supplies its management/listing locator; alternates never
 * become additional page rows.
 */
export interface PageAggregate {
  readonly page_id: PageId;
  readonly endpoint_set: PageEndpointSet;
  readonly stewardship: PageStewardship;
  readonly access: PageAccess;
  readonly tags: readonly PageTag[];
  /** Positive safe integer, starting at 1 and incremented once per mutation. */
  readonly revision: number;
  readonly content_asset_id: ContentAssetId;
  /** Present only after a definitive external delivery failure. */
  readonly external_missing?: ExternalContentMissingState;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export function external_content_missing_state_violation(
  value: unknown,
): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "external_missing must contain a valid cause and detection time";
  }
  const candidate = value as Record<string, unknown>;
  if (
    !external_content_missing_causes.includes(
      candidate.cause as ExternalContentMissingCause,
    ) ||
    !(candidate.detected_at instanceof Date) ||
    !Number.isFinite(candidate.detected_at.getTime())
  ) {
    return "external_missing must contain a valid cause and detection time";
  }
  return null;
}

/** Storage resolution of one locator to one binding of one logical page. */
export interface ResolvedPageEndpoint {
  readonly page: PageAggregate;
  readonly endpoint: PageEndpointBinding;
}

export function page_aggregate_endpoint_bindings(
  page: PageAggregate,
): readonly PageEndpointBinding[] {
  return [page.endpoint_set.canonical, ...page.endpoint_set.alternates];
}

/** First application-invariant violation, or null for a coherent aggregate. */
export function page_aggregate_violation(page: PageAggregate): string | null {
  if (!is_valid_page_id(page.page_id)) {
    return "page_id must be a route-safe opaque id";
  }
  const endpoint_violation = page_endpoint_set_violation(page.endpoint_set);
  if (endpoint_violation !== null) return endpoint_violation;
  if (!is_valid_page_access(page.access)) {
    return "access must be public or private";
  }
  if (!is_valid_page_tags(page.tags)) {
    return "tags must be a bounded canonical sorted unique set";
  }
  if (
    page.stewardship.kind !== "trial" &&
    page.stewardship.kind !== "managed"
  ) {
    return "stewardship kind must be trial or managed";
  }
  if (page.stewardship.kind === "trial" && page.access !== "public") {
    return "trial pages must be public";
  }
  if (page.stewardship.kind === "trial" && page.tags.length !== 0) {
    return "trial pages must not have tags";
  }
  if (
    page.stewardship.kind === "managed" &&
    page.stewardship.owner_user_id === ""
  ) {
    return "managed owner_user_id must be non-empty";
  }
  if (!is_valid_page_revision(page.revision)) {
    return "revision must be a positive safe integer";
  }
  if (!is_valid_content_asset_id(page.content_asset_id)) {
    return "content_asset_id must be a route-safe opaque id";
  }
  if (page.external_missing !== undefined) {
    const external_missing_violation = external_content_missing_state_violation(
      page.external_missing,
    );
    if (external_missing_violation !== null) return external_missing_violation;
  }
  if (
    !(page.created_at instanceof Date) ||
    !Number.isFinite(page.created_at.getTime()) ||
    !(page.updated_at instanceof Date) ||
    !Number.isFinite(page.updated_at.getTime())
  ) {
    return "timestamps must be valid dates";
  }
  return null;
}
