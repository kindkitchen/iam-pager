import type { DeliveryPayload } from "../content/model.ts";
import type { Locator } from "../locator/model.ts";
import type {
  PageEndpointLink,
  PageEndpointLinks,
  PageEndpointSetIntent,
  PlanPageEndpointSetResult,
} from "./endpoint.ts";
import type {
  PageAccess,
  PageContent,
  PageId,
  PageRecord,
  PageTag,
} from "./model.ts";

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
 * server-derived. Namespace is an exact case-insensitive filter; page name is
 * a normalized case-insensitive substring; access and tag are exact. Supplied
 * filters use AND semantics. `cursor` is an opaque continuation token from a
 * previous result issued with the same complete filter scope.
 */
export interface ListManagedRequest {
  owner_user_id: string;
  namespace?: string;
  page_name_query?: string;
  access?: PageAccess;
  tag?: PageTag;
  /** Maximum records to return; a positive safe integer (HTTP bounds 1-100). */
  limit: number;
  cursor?: string;
}

export type ListManagedResult =
  | { ok: true; pages: PageRecord[]; next_cursor: string | null }
  | { ok: false; reason: "invalid_cursor" };

/**
 * Bounded visitor-facing listing of one namespace's public managed pages
 * (DS-VIEW). `namespace` matches case-insensitively; `cursor` is an opaque
 * continuation token from a previous result for the same namespace. Private
 * pages and trial (guest) pages never appear: an unreserved namespace lists
 * empty, and eligibility gaps are skipped without shortening a page of
 * results.
 */
export interface ListPublicRequest {
  namespace: string;
  /** Maximum records to return; a positive safe integer. */
  limit: number;
  cursor?: string;
}

export type ListPublicResult =
  | { ok: true; pages: PageRecord[]; next_cursor: string | null }
  | { ok: false; reason: "invalid_cursor" };

/**
 * Cross-namespace public exploration storage request (DS-EXPLORE). Query
 * name values are optional normalized lowercase substrings and tag is an
 * optional canonical exact match. All supplied fields use AND semantics. A
 * page-name query never matches a default page. Private and trial pages never
 * appear.
 */
export interface ExplorePublicRequest {
  namespace_query?: string;
  page_name_query?: string;
  tag?: PageTag;
  /** Maximum records to return; a positive safe integer. */
  limit: number;
  /** Opaque continuation bound to the complete active query scope. */
  cursor?: string;
}

export type ExplorePublicResult =
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
  /** Canonical tags; omission creates an untagged page. */
  tags?: readonly PageTag[];
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
 * stewardship, and creation time never change. Omitted `content` or `tags`
 * preserve the corresponding stored value for metadata-only updates.
 */
export interface ReplaceManagedRequest {
  page_id: PageId;
  owner_user_id: string;
  expected_revision: number;
  access: PageAccess;
  /** Omission preserves tags; an empty set clears them. */
  tags?: readonly PageTag[];
  content?: PageContent;
  now: Date;
}

export type ReplaceManagedResult =
  | { ok: true; page: PageRecord }
  | { ok: false; reason: "not_found" | "revision_conflict" };

/**
 * Revision-bound locator move within the page's current namespace. The page id,
 * content, access, tags, stewardship, and creation time stay stable. A target trial
 * may be retired, but another managed page is always a conflict.
 */
export interface RenameManagedRequest {
  page_id: PageId;
  owner_user_id: string;
  expected_revision: number;
  locator: Locator;
  now: Date;
}

export type RenameManagedResult =
  | {
    ok: true;
    outcome: "renamed" | "replaced_trial";
    page: PageRecord;
  }
  | {
    ok: false;
    reason: "not_found" | "revision_conflict" | "locator_conflict";
  };

/**
 * Revision-bound copy from one managed source into a generated locator in the
 * same namespace. The source is unchanged; the copy receives a fresh id,
 * creation timestamp, and revision 1 while retaining content, access, and tags.
 */
export interface DuplicateManagedRequest {
  source_page_id: PageId;
  owner_user_id: string;
  expected_revision: number;
  page_id: PageId;
  locator: Locator;
  now: Date;
}

export type DuplicateManagedResult =
  | {
    ok: true;
    outcome: "created" | "replaced_trial";
    page: PageRecord;
  }
  | {
    ok: false;
    reason:
      | "not_found"
      | "revision_conflict"
      | "locator_conflict"
      | "page_id_conflict";
  };

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
 * Storage for pages (DS-PROTECT, DS-MANAGE). Implementations own atomic
 * identity/index/revision/locator conditions; services own validation,
 * authorization, derivation, tag normalization, and business results.
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
  list_public(request: ListPublicRequest): Promise<ListPublicResult>;
  explore_public(request: ExplorePublicRequest): Promise<ExplorePublicResult>;
  put_trial(request: PutTrialRequest): Promise<PutTrialResult>;
  create_managed(request: CreateManagedRequest): Promise<CreateManagedResult>;
  replace_managed(
    request: ReplaceManagedRequest,
  ): Promise<ReplaceManagedResult>;
  rename_managed(request: RenameManagedRequest): Promise<RenameManagedResult>;
  duplicate_managed(
    request: DuplicateManagedRequest,
  ): Promise<DuplicateManagedResult>;
  delete_managed(request: DeleteManagedRequest): Promise<DeleteManagedResult>;
}

/**
 * Visitor-safe public representation (DS-VIEW): no page id, owner identity,
 * or revision leaves the contract. `stewardship` only distinguishes
 * creator-backed pages from unowned trial output. Tags are creator-supplied
 * discovery metadata and trial summaries always carry an empty set.
 */
export interface PublicPageSummary {
  /** Canonical compatibility fields; complete delivery links are in `endpoints`. */
  locator: Locator;
  path: string;
  endpoints: PageEndpointLinks;
  stewardship: "trial" | "managed";
  content_type: string;
  media_type: string;
  size_bytes: number;
  tags: PageTag[];
  created_at: Date;
  updated_at: Date;
}

/** Owner-safe management representation; stewardship and source are omitted. */
export interface PageSummary {
  page_id: PageId;
  /** Canonical compatibility fields; complete delivery links are in `endpoints`. */
  locator: Locator;
  path: string;
  endpoints: PageEndpointLinks;
  access: PageAccess;
  content_type: string;
  size_bytes: number;
  tags: PageTag[];
  created_at: Date;
  updated_at: Date;
  revision: number;
}

export interface ManagedPageInspection extends PageSummary {
  content: {
    content_type: string;
    /** Handler-owned bounded projection; binary types must omit payload bytes. */
    input: unknown;
  };
}

export interface PageContentCommand {
  content_type: string;
  input: unknown;
}

/** One-locator compatibility or a complete publisher-configured endpoint set. */
export type PageEndpointCommand =
  | { readonly locator: Locator; readonly endpoint_set?: never }
  | {
    readonly locator?: never;
    readonly endpoint_set: PageEndpointSetIntent;
  };

export type PageEndpointCommandFailureReason =
  | Exclude<PlanPageEndpointSetResult, { ok: true }>["reason"]
  | "endpoint_set_unsupported";

export type PublishTrialPageRequest = PageEndpointCommand & {
  actor: GuestPageActor;
  access: PageAccess;
  content: PageContentCommand;
};

export type PublishTrialPageResult =
  | {
    ok: true;
    outcome: "created" | "replaced";
    page: PageSummary;
  }
  | {
    ok: false;
    reason:
      | PageEndpointCommandFailureReason
      | "invalid_access"
      | "private_requires_managed_page"
      | "namespace_reserved"
      | "endpoint_conflict"
      | "revision_exhausted"
      | "unknown_content_type"
      | "page_id_generation_exhausted";
  }
  | { ok: false; reason: "invalid_input"; detail: string };

export type CreateManagedPageRequest = PageEndpointCommand & {
  actor: UserPageActor;
  access: PageAccess;
  tags?: readonly string[];
  content: PageContentCommand;
};

export type CreateManagedPageResult =
  | {
    ok: true;
    outcome: "created" | "replaced_trial";
    page: PageSummary;
  }
  | {
    ok: false;
    reason:
      | PageEndpointCommandFailureReason
      | "invalid_access"
      | "invalid_tags"
      | "namespace_not_reserved"
      | "namespace_reserved"
      | "page_exists"
      | "unknown_content_type"
      | "page_id_generation_exhausted";
  }
  | { ok: false; reason: "invalid_input"; detail: string };

export const max_managed_page_name_query_length = 100;

export interface ListManagedPagesRequest {
  actor: UserPageActor;
  namespace?: string;
  page_name_query?: string;
  access?: PageAccess;
  tag?: string;
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
      | "invalid_filter"
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
    tags?: readonly string[];
    content?: PageContentCommand;
    /** Complete replacement intent; omission preserves every binding. */
    endpoint_set?: PageEndpointSetIntent;
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
      | "invalid_tags"
      | "page_exists"
      | PageEndpointCommandFailureReason
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

/** Maximum number of distinct pages accepted by one bulk management command. */
export const max_bulk_managed_pages = 100;

/** One explicit page/revision pair selected by a creator for a bulk command. */
export interface ManagedPageRevisionSelection {
  page_id: PageId;
  expected_revision: number;
}

export interface BulkChangeManagedPageAccessRequest {
  actor: UserPageActor;
  access: PageAccess;
  selection: readonly ManagedPageRevisionSelection[];
}

export type BulkChangeManagedPageAccessItemResult =
  | { page_id: PageId; ok: true; page: PageSummary }
  | {
    page_id: PageId;
    ok: false;
    reason: "not_found" | "revision_conflict" | "revision_exhausted";
  };

/**
 * A valid command returns one ordered result per selected page. Item failures
 * do not roll back successful items. The complete selection is rejected before
 * mutation unless it contains 1-100 distinct, valid page/revision pairs.
 */
export type BulkChangeManagedPageAccessResult =
  | { ok: true; results: BulkChangeManagedPageAccessItemResult[] }
  | { ok: false; reason: "invalid_access" | "invalid_selection" };

export interface BulkDeleteManagedPagesRequest {
  actor: UserPageActor;
  selection: readonly ManagedPageRevisionSelection[];
}

export type BulkDeleteManagedPageItemResult =
  | { page_id: PageId; ok: true }
  | {
    page_id: PageId;
    ok: false;
    reason: "not_found" | "revision_conflict";
  };

/** Ordered, independently revision-bound deletion outcomes for one selection. */
export type BulkDeleteManagedPagesResult =
  | { ok: true; results: BulkDeleteManagedPageItemResult[] }
  | { ok: false; reason: "invalid_selection" };

export interface RenameManagedPageRequest {
  actor: UserPageActor;
  page_id: PageId;
  expected_revision: number;
  /** Omit to make this namespace's default page. */
  page_name?: string;
}

export type RenameManagedPageResult =
  | {
    ok: true;
    outcome: "renamed" | "replaced_trial" | "unchanged";
    page: ManagedPageInspection;
  }
  | {
    ok: false;
    reason:
      | "not_found"
      | "revision_conflict"
      | "revision_exhausted"
      | "invalid_page_name"
      | "page_exists"
      | "unknown_content_type";
  };

export interface DuplicateManagedPageRequest {
  actor: UserPageActor;
  page_id: PageId;
  expected_revision: number;
  /** Required for sources outside the one-inline-endpoint compatibility shape. */
  endpoint_set?: PageEndpointSetIntent;
}

export type DuplicateManagedPageResult =
  | {
    ok: true;
    outcome: "created" | "replaced_trial";
    page: ManagedPageInspection;
  }
  | {
    ok: false;
    reason:
      | "not_found"
      | "revision_conflict"
      | "unknown_content_type"
      | "endpoint_set_required"
      | "page_exists"
      | PageEndpointCommandFailureReason
      | "page_name_generation_exhausted"
      | "page_id_generation_exhausted";
  };

export type ViewPublicPageResult =
  | {
    ok: true;
    page: PublicPageSummary;
    /** Rendered content when its handler remains available; null is fallback. */
    payload: DeliveryPayload | null;
  }
  | { ok: false; reason: "not_found" };

export interface ListPublicPagesRequest {
  namespace: string;
  limit: number;
  cursor?: string;
}

export type ListPublicPagesResult =
  | { ok: true; pages: PublicPageSummary[]; next_cursor: string | null }
  | {
    ok: false;
    reason: "forbidden_namespace" | "invalid_namespace" | "invalid_cursor";
  };

/** Maximum trimmed query length accepted by public exploration. */
export const max_public_exploration_query_length = 100;

export interface ExplorePublicPagesRequest {
  namespace_query?: string;
  page_name_query?: string;
  tag?: string;
  limit: number;
  cursor?: string;
}

export type ExplorePublicPagesResult =
  | { ok: true; pages: PublicPageSummary[]; next_cursor: string | null }
  | { ok: false; reason: "invalid_query" | "invalid_cursor" };

export type DeliverPageResult =
  | {
    ok: true;
    page: PageRecord;
    /** Exact resolved binding; HTTP disposition is selected from its profile. */
    endpoint: PageEndpointLink;
    payload: DeliveryPayload;
  }
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

export interface ManagedPageBulkAccessChanger {
  bulk_change_managed_access(
    request: BulkChangeManagedPageAccessRequest,
  ): Promise<BulkChangeManagedPageAccessResult>;
}

export interface ManagedPageBulkDeleter {
  bulk_delete_managed(
    request: BulkDeleteManagedPagesRequest,
  ): Promise<BulkDeleteManagedPagesResult>;
}

export interface ManagedPageRenamer {
  rename_managed(
    request: RenameManagedPageRequest,
  ): Promise<RenameManagedPageResult>;
}

export interface ManagedPageDuplicator {
  duplicate_managed(
    request: DuplicateManagedPageRequest,
  ): Promise<DuplicateManagedPageResult>;
}

export interface PageDeliverer {
  deliver(locator: Locator, actor: PageActor): Promise<DeliverPageResult>;
}

/**
 * Resolves an eligible public page for wrapped viewing (CP-VIEW). A locator
 * without a page name resolves the namespace's default page, so this one
 * operation also answers "does the creator have a default page". Missing,
 * private, and structurally invalid locators collapse into one non-disclosing
 * `not_found` (OQ-ACCESS, OQ-MISSING).
 */
export interface PublicPageViewer {
  view_public(locator: Locator): Promise<ViewPublicPageResult>;
}

/** Lists a creator namespace's public pages for the site wrapper (CP-VIEW). */
export interface PublicPageLister {
  list_public(
    request: ListPublicPagesRequest,
  ): Promise<ListPublicPagesResult>;
}

/**
 * Browses and searches public managed pages across namespaces (CP-EXPLORE).
 * Name search is case-insensitive substring matching and tag filtering is an
 * exact canonical match. All supplied fields use AND semantics. Results remain
 * visitor-safe and cursor-bounded.
 */
export interface PublicPageExplorer {
  explore_public(
    request: ExplorePublicPagesRequest,
  ): Promise<ExplorePublicPagesResult>;
}
