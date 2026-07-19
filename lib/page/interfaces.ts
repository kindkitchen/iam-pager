import type { Locator } from "../locator/model.ts";
import type { PageAccess, PageContent, PageId, PageRecord } from "./model.ts";

/** Produces opaque route-safe page ids; injected so services stay testable. */
export interface PageIdGenerator {
  generate(): PageId;
}

/**
 * Bounded listing of one owner's managed pages. The owner id is always
 * server-derived; `namespace` filters case-insensitively; `cursor` is an
 * opaque continuation token from a previous result issued with the same
 * filter.
 */
export interface ListManagedRequest {
  owner_user_id: string;
  namespace?: string;
  /** Maximum records to return; a positive safe integer (HTTP bounds 1-100). */
  limit: number;
  cursor?: string;
}

export type ListManagedResult =
  | { ok: true; pages: PageRecord[]; next_cursor: string | null }
  | { ok: false; reason: "invalid_cursor" };

/**
 * Trial create-or-replace. Atomically creates at an absent locator (using the
 * generated `page_id`) or replaces an existing trial page, preserving its id
 * and creation time and incrementing its revision. Never touches a managed
 * page. Trial pages are always public.
 */
export interface PutTrialRequest {
  /** Generated id, used only when the locator has no page yet. */
  page_id: PageId;
  locator: Locator;
  content: PageContent;
  now: Date;
}

export type PutTrialResult =
  | { ok: true; outcome: "created" | "replaced"; page: PageRecord }
  | { ok: false; reason: "managed_conflict" | "page_id_conflict" };

/**
 * Managed creation. Atomically creates at an absent locator or replaces a
 * trial page (retiring the trial's page id); conflicts with any managed page
 * at the locator. The new record starts at revision 1 with one timestamp.
 */
export interface CreateManagedRequest {
  page_id: PageId;
  locator: Locator;
  owner_user_id: string;
  access: PageAccess;
  content: PageContent;
  now: Date;
}

export type CreateManagedResult =
  | { ok: true; outcome: "created" | "replaced_trial"; page: PageRecord }
  | { ok: false; reason: "managed_conflict" | "page_id_conflict" };

/**
 * Revision-bound managed replacement. Succeeds only when the page exists, is
 * managed, is owned by `owner_user_id`, and its revision equals
 * `expected_revision`; then increments the revision exactly once. Locator,
 * stewardship, and creation time never change. Omitted `content` preserves
 * the stored content exactly (access-only update).
 */
export interface ReplaceManagedRequest {
  page_id: PageId;
  owner_user_id: string;
  expected_revision: number;
  access: PageAccess;
  content?: PageContent;
  now: Date;
}

export type ReplaceManagedResult =
  | { ok: true; page: PageRecord }
  | { ok: false; reason: "not_found" | "revision_conflict" };

/** Revision-bound managed deletion with the same authority conditions. */
export interface DeleteManagedRequest {
  page_id: PageId;
  owner_user_id: string;
  expected_revision: number;
}

export type DeleteManagedResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "revision_conflict" };

/**
 * Storage for pages (DS-PROTECT). Implementations own atomic
 * identity/index/revision conditions; services own validation, authorization,
 * derivation, and business results.
 *
 * Missing, trial, and foreign pages collapse into one non-disclosing
 * `not_found` result for managed mutations, so callers cannot probe
 * ownership through this contract. Structurally invalid requests (malformed
 * ids, non-positive limits or revisions, empty owner ids) are programming
 * errors and throw instead of returning typed results.
 */
export interface PageRepository {
  /** Case-insensitive direct resolution; null when absent. */
  find_by_locator(locator: Locator): Promise<PageRecord | null>;
  /** Management resolution by opaque id; null when absent. */
  find_by_id(page_id: PageId): Promise<PageRecord | null>;
  list_managed(request: ListManagedRequest): Promise<ListManagedResult>;
  put_trial(request: PutTrialRequest): Promise<PutTrialResult>;
  create_managed(request: CreateManagedRequest): Promise<CreateManagedResult>;
  replace_managed(
    request: ReplaceManagedRequest,
  ): Promise<ReplaceManagedResult>;
  delete_managed(request: DeleteManagedRequest): Promise<DeleteManagedResult>;
}
