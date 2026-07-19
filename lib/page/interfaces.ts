import type { DeliveryPayload } from "../content/model.ts";
import type { Locator } from "../locator/model.ts";
import type { PageAccess, PageContent, PageId, PageRecord } from "./model.ts";

/** HTTP-independent caller authority, derived by an outer transport boundary. */
export type PageActor = GuestPageActor | UserPageActor;
export interface GuestPageActor {
  kind: "guest";
}
export interface UserPageActor {
  kind: "user";
  user_id: string;
}

/** Namespace relation to the supplied actor; owner ids never leave the resolver. */
export type NamespaceAuthority =
  | { kind: "unreserved" }
  | { kind: "owned" }
  | { kind: "reserved_by_other" };

export interface NamespaceAuthorityResolver {
  resolve(
    actor: PageActor,
    namespace: string,
  ): Promise<NamespaceAuthority>;
}

/** Injectable application clock; storage receives one operation timestamp. */
export interface PageClock {
  now(): Date;
}

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

/** Owner-safe management representation; stewardship and source are omitted. */
export interface PageSummary {
  page_id: PageId;
  locator: Locator;
  path: string;
  access: PageAccess;
  content_type: string;
  size_bytes: number;
  created_at: Date;
  updated_at: Date;
  revision: number;
}

export interface ManagedPageInspection extends PageSummary {
  content: {
    content_type: string;
    input: unknown;
  };
}

export interface PageContentCommand {
  content_type: string;
  input: unknown;
}

export interface PublishTrialPageRequest {
  actor: GuestPageActor;
  locator: Locator;
  access: PageAccess;
  content: PageContentCommand;
}

export type PublishTrialPageResult =
  | {
    ok: true;
    outcome: "created" | "replaced";
    page: PageSummary;
  }
  | {
    ok: false;
    reason:
      | "forbidden_namespace"
      | "invalid_locator"
      | "invalid_access"
      | "private_requires_managed_page"
      | "namespace_reserved"
      | "unknown_content_type"
      | "page_id_generation_exhausted";
  }
  | { ok: false; reason: "invalid_input"; detail: string };

export interface CreateManagedPageRequest {
  actor: UserPageActor;
  locator: Locator;
  access: PageAccess;
  content: PageContentCommand;
}

export type CreateManagedPageResult =
  | {
    ok: true;
    outcome: "created" | "replaced_trial";
    page: PageSummary;
  }
  | {
    ok: false;
    reason:
      | "forbidden_namespace"
      | "invalid_locator"
      | "invalid_access"
      | "namespace_not_reserved"
      | "namespace_reserved"
      | "page_exists"
      | "unknown_content_type"
      | "page_id_generation_exhausted";
  }
  | { ok: false; reason: "invalid_input"; detail: string };

export interface ListManagedPagesRequest {
  actor: UserPageActor;
  namespace?: string;
  limit: number;
  cursor?: string;
}

export type ListManagedPagesResult =
  | { ok: true; pages: PageSummary[]; next_cursor: string | null }
  | {
    ok: false;
    reason:
      | "forbidden_namespace"
      | "invalid_namespace"
      | "namespace_not_owned"
      | "invalid_cursor";
  };

export interface InspectManagedPageRequest {
  actor: UserPageActor;
  page_id: PageId;
}

export type InspectManagedPageResult =
  | { ok: true; page: ManagedPageInspection }
  | { ok: false; reason: "not_found" | "unknown_content_type" };

export interface UpdateManagedPageRequest {
  actor: UserPageActor;
  page_id: PageId;
  expected_revision: number;
  patch: {
    access?: PageAccess;
    content?: PageContentCommand;
  };
}

export type UpdateManagedPageResult =
  | { ok: true; page: ManagedPageInspection }
  | {
    ok: false;
    reason:
      | "not_found"
      | "revision_conflict"
      | "revision_exhausted"
      | "empty_patch"
      | "invalid_access"
      | "unknown_content_type";
  }
  | { ok: false; reason: "invalid_input"; detail: string };

export interface DeleteManagedPageRequest {
  actor: UserPageActor;
  page_id: PageId;
  expected_revision: number;
}

export type DeleteManagedPageResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "revision_conflict" };

export type DeliverPageResult =
  | { ok: true; page: PageRecord; payload: DeliveryPayload }
  | {
    ok: false;
    reason: "not_found" | "unknown_content_type" | "corrupt";
  };

export interface TrialPagePublisher {
  publish_trial(
    request: PublishTrialPageRequest,
  ): Promise<PublishTrialPageResult>;
}

export interface ManagedPageCreator {
  create_managed(
    request: CreateManagedPageRequest,
  ): Promise<CreateManagedPageResult>;
}

export interface ManagedPageLister {
  list_managed(
    request: ListManagedPagesRequest,
  ): Promise<ListManagedPagesResult>;
}

export interface ManagedPageInspector {
  inspect_managed(
    request: InspectManagedPageRequest,
  ): Promise<InspectManagedPageResult>;
}

export interface ManagedPageUpdater {
  update_managed(
    request: UpdateManagedPageRequest,
  ): Promise<UpdateManagedPageResult>;
}

export interface ManagedPageDeleter {
  delete_managed(
    request: DeleteManagedPageRequest,
  ): Promise<DeleteManagedPageResult>;
}

export interface PageDeliverer {
  deliver(locator: Locator, actor: PageActor): Promise<DeliverPageResult>;
}
