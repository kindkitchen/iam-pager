import type { ContentAssetId } from "../content/asset.ts";
import type { Locator } from "../locator/model.ts";
import type { PageAggregate, ResolvedPageEndpoint } from "./aggregate.ts";
import type { PageEndpointSet } from "./endpoint.ts";
import type { PageAccess, PageId, PageTag } from "./model.ts";

/** Reads logical page state by stable management identity. */
export interface PageAggregateReader {
  find_page_aggregate_by_id(page_id: PageId): Promise<PageAggregate | null>;
}

/** Resolves canonical and alternate locators without applying page access. */
export interface PageEndpointResolver {
  resolve_page_endpoint(locator: Locator): Promise<ResolvedPageEndpoint | null>;
}

export interface PutTrialPageAggregateRequest {
  /** Generated identity, used only when no claimed endpoint already has a trial. */
  readonly page_id: PageId;
  readonly endpoint_set: PageEndpointSet;
  /** Must name a fully created immutable asset. */
  readonly content_asset_id: ContentAssetId;
  readonly now: Date;
}

export type PutTrialPageAggregateResult =
  | {
    readonly ok: true;
    readonly outcome: "created" | "replaced";
    readonly page: PageAggregate;
  }
  | {
    readonly ok: false;
    readonly reason:
      | "managed_conflict"
      | "endpoint_conflict"
      | "page_id_conflict"
      | "content_asset_not_found"
      | "revision_exhausted";
  };

/** Atomic trial publication over one complete endpoint set. */
export interface TrialPageAggregatePublisher {
  put_trial_page_aggregate(
    request: PutTrialPageAggregateRequest,
  ): Promise<PutTrialPageAggregateResult>;
}

export interface CreateManagedPageAggregateRequest {
  readonly page_id: PageId;
  readonly endpoint_set: PageEndpointSet;
  readonly owner_user_id: string;
  readonly access: PageAccess;
  readonly tags?: readonly PageTag[];
  /** Must name a fully created immutable asset. */
  readonly content_asset_id: ContentAssetId;
  readonly now: Date;
}

export type CreateManagedPageAggregateResult =
  | {
    readonly ok: true;
    readonly outcome: "created" | "replaced_trial";
    readonly page: PageAggregate;
  }
  | {
    readonly ok: false;
    readonly reason:
      | "managed_conflict"
      | "page_id_conflict"
      | "content_asset_not_found";
  };

/** Atomic managed creation; every claimed trial is retired or none are. */
export interface ManagedPageAggregateCreator {
  create_managed_page_aggregate(
    request: CreateManagedPageAggregateRequest,
  ): Promise<CreateManagedPageAggregateResult>;
}

/**
 * One revision-bound aggregate mutation. Omitted fields remain unchanged. An
 * endpoint change supplies the complete replacement set in the page's current
 * case-insensitive namespace, and content replacement selects an already-created
 * immutable asset.
 */
export interface UpdateManagedPageAggregateRequest {
  readonly page_id: PageId;
  readonly owner_user_id: string;
  readonly expected_revision: number;
  readonly patch: {
    readonly endpoint_set?: PageEndpointSet;
    readonly content_asset_id?: ContentAssetId;
    readonly access?: PageAccess;
    readonly tags?: readonly PageTag[];
  };
  readonly now: Date;
}

export type UpdateManagedPageAggregateResult =
  | {
    readonly ok: true;
    readonly outcome: "updated" | "replaced_trial";
    readonly page: PageAggregate;
  }
  | {
    readonly ok: false;
    readonly reason:
      | "not_found"
      | "revision_conflict"
      | "revision_exhausted"
      | "endpoint_conflict"
      | "content_asset_not_found";
  };

/** Atomic content, endpoint, access, and tag mutation capability. */
export interface ManagedPageAggregateUpdater {
  update_managed_page_aggregate(
    request: UpdateManagedPageAggregateRequest,
  ): Promise<UpdateManagedPageAggregateResult>;
}

export interface DuplicateManagedPageAggregateRequest {
  readonly source_page_id: PageId;
  readonly owner_user_id: string;
  readonly expected_revision: number;
  readonly page_id: PageId;
  /** Fresh complete source-namespace destination set; locators are not copied. */
  readonly endpoint_set: PageEndpointSet;
  readonly now: Date;
}

export type DuplicateManagedPageAggregateResult =
  | {
    readonly ok: true;
    readonly outcome: "created" | "replaced_trial";
    readonly page: PageAggregate;
  }
  | {
    readonly ok: false;
    readonly reason:
      | "not_found"
      | "revision_conflict"
      | "endpoint_conflict"
      | "page_id_conflict";
  };

/** Revision-bound duplication that safely shares the immutable source asset. */
export interface ManagedPageAggregateDuplicator {
  duplicate_managed_page_aggregate(
    request: DuplicateManagedPageAggregateRequest,
  ): Promise<DuplicateManagedPageAggregateResult>;
}

export interface DeleteManagedPageAggregateRequest {
  readonly page_id: PageId;
  readonly owner_user_id: string;
  readonly expected_revision: number;
}

export type DeleteManagedPageAggregateResult =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly reason: "not_found" | "revision_conflict";
  };

/** Removes one logical page and all endpoint visibility, but not shared assets. */
export interface ManagedPageAggregateDeleter {
  delete_managed_page_aggregate(
    request: DeleteManagedPageAggregateRequest,
  ): Promise<DeleteManagedPageAggregateResult>;
}
