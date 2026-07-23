import type { DeliveryPayload } from "../content/model.ts";
import type { Locator } from "../locator/model.ts";
import type {
  PageEndpointLink,
  PageEndpointLinks,
  PageEndpointSetIntent,
  PlanPageEndpointSetResult,
} from "./endpoint.ts";
import type { ExternalContentMissingState } from "./aggregate.ts";
import type { PageAccess, PageId, PageTag } from "./model.ts";

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
 * Visitor-safe public representation: no page id, owner identity,
 * or revision leaves the contract. `stewardship` only distinguishes
 * creator-backed pages from unowned trial output. Tags are creator-supplied
 * discovery metadata and trial summaries always carry an empty set.
 */
export interface PublicPageSummary {
  /** Canonical locator and path; complete delivery links are in `endpoints`. */
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
  /** Canonical locator and path; complete delivery links are in `endpoints`. */
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
  /** Owner-only external delivery health; omitted from visitor projections. */
  external_missing?: ExternalContentMissingState;
}

export interface ManagedPageInspection extends PageSummary {
  content: {
    content_type: string;
    /** Handler-owned bounded projection; binary types must omit payload bytes. */
    input: unknown;
    /** Owner-safe pointer details; connection identity remains server-side. */
    external_source?: {
      provider_id: string;
      external_ref: string;
    };
  };
}

export interface PageContentCommand {
  content_type: string;
  input: unknown;
  /** Omit for inline custody; provider selection never accepts a connection ID. */
  storage?: { readonly provider_id: string };
}

export type ExternalPublicationFailureReason =
  | "external_storage_requires_managed_page"
  | "invalid_storage_provider"
  | "storage_connection_not_found"
  | "storage_provider_unavailable"
  | "storage_provider_not_writable"
  | "external_content_missing"
  | "connection_revoked"
  | "external_source_unreachable";

/**
 * Inline canonical-locator shorthand or a complete publisher-configured
 * non-empty locator-reference set. The shorthand is retained for existing
 * Markdown clients; new callers should make delivery profile explicit.
 */
export type PageEndpointCommand =
  | { readonly locator: Locator; readonly endpoint_set?: never }
  | {
    readonly locator?: never;
    readonly endpoint_set: PageEndpointSetIntent;
  };

export type PageEndpointCommandFailureReason = Exclude<
  PlanPageEndpointSetResult,
  { ok: true }
>["reason"];

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
      | "endpoint_capacity_exceeded"
      | "revision_exhausted"
      | "unknown_content_type"
      | ExternalPublicationFailureReason
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
      | "endpoint_capacity_exceeded"
      | "unknown_content_type"
      | ExternalPublicationFailureReason
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
  /** When present, selects pages by external delivery health. */
  external_missing?: boolean;
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
  | { ok: false; reason: "not_found" };

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
      | "namespace_not_reserved"
      | "namespace_reserved"
      | "endpoint_capacity_exceeded"
      | PageEndpointCommandFailureReason
      | "unknown_content_type"
      | ExternalPublicationFailureReason;
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

export interface RelinkManagedExternalContentRequest {
  actor: UserPageActor;
  page_id: PageId;
  expected_revision: number;
  /** Provider-native object ID on the page's existing owner-proven connection. */
  external_ref: string;
}

export type RelinkManagedExternalContentResult =
  | { ok: true; page: ManagedPageInspection }
  | {
    ok: false;
    reason:
      | "not_found"
      | "revision_conflict"
      | "revision_exhausted"
      | "content_not_external"
      | "invalid_external_ref"
      | "provider_unavailable"
      | "external_content_missing"
      | "connection_revoked"
      | "external_source_unreachable"
      | "external_content_mismatch";
  };

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
      | "page_exists";
  };

export interface DuplicateManagedPageRequest {
  actor: UserPageActor;
  page_id: PageId;
  expected_revision: number;
  /** Explicit fresh destination set; required for nontrivial sources. */
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
      | "endpoint_set_required"
      | "page_exists"
      | "namespace_not_reserved"
      | "namespace_reserved"
      | "endpoint_capacity_exceeded"
      | PageEndpointCommandFailureReason
      | "page_name_generation_exhausted"
      | "page_id_generation_exhausted";
  };

export type ViewPublicPageResult =
  | {
    ok: true;
    page: PublicPageSummary;
    payload: DeliveryPayload;
  }
  | { ok: false; reason: "not_found" }
  | {
    ok: false;
    reason: "external_content_unavailable";
    page: PublicPageSummary;
    payload: DeliveryPayload;
    retry_after_seconds?: number;
  };

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
    page: {
      page_id: PageId;
      revision: number;
      size_bytes: number;
    };
    /** Exact resolved binding; HTTP disposition is selected from its profile. */
    endpoint: PageEndpointLink;
    payload: DeliveryPayload;
  }
  | { ok: false; reason: "not_found" | "corrupt" }
  | {
    ok: false;
    reason: "external_content_unavailable";
    payload: DeliveryPayload;
    retry_after_seconds?: number;
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

export interface ManagedExternalContentRelinker {
  relink_managed_external_content(
    request: RelinkManagedExternalContentRequest,
  ): Promise<RelinkManagedExternalContentResult>;
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
 * `not_found`.
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
