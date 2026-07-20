import {
  content_asset_violation,
  type ContentAsset,
  type ContentAssetId,
  is_valid_content_asset_id,
} from "../content/asset.ts";
import type {
  ContentAssetCreator,
  ContentAssetReader,
  CreateContentAssetResult,
} from "../content/interfaces.ts";
import { type Locator, locator_key } from "../locator/model.ts";
import {
  page_aggregate_endpoint_bindings,
  page_aggregate_violation,
  type PageAggregate,
  type ResolvedPageEndpoint,
} from "./aggregate.ts";
import type {
  CreateManagedPageAggregateRequest,
  CreateManagedPageAggregateResult,
  DeleteManagedPageAggregateRequest,
  DeleteManagedPageAggregateResult,
  DuplicateManagedPageAggregateRequest,
  DuplicateManagedPageAggregateResult,
  ManagedPageAggregateCreator,
  ManagedPageAggregateDeleter,
  ManagedPageAggregateDuplicator,
  ManagedPageAggregateUpdater,
  PageAggregateReader,
  PageEndpointResolver,
  PutTrialPageAggregateRequest,
  PutTrialPageAggregateResult,
  TrialPageAggregatePublisher,
  UpdateManagedPageAggregateRequest,
  UpdateManagedPageAggregateResult,
} from "./aggregate-interfaces.ts";
import {
  page_endpoint_set_violation,
  type PageEndpointSet,
} from "./endpoint.ts";
import {
  is_valid_page_access,
  is_valid_page_id,
  is_valid_page_revision,
  is_valid_page_tags,
  type PageId,
} from "./model.ts";

function require(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`page aggregate repository: ${message}`);
}

function is_valid_time(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/** Boundary isolation: callers can never alias internal repository state. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Process-local reference for immutable assets and atomic page/endpoint state.
 * Mutation methods deliberately contain no awaits, so each check/set sequence
 * is one event-loop turn and concurrent promises observe complete commits.
 */
export class MemoryPageAggregateRepository
  implements
    ContentAssetCreator,
    ContentAssetReader,
    PageAggregateReader,
    PageEndpointResolver,
    TrialPageAggregatePublisher,
    ManagedPageAggregateCreator,
    ManagedPageAggregateUpdater,
    ManagedPageAggregateDuplicator,
    ManagedPageAggregateDeleter {
  readonly #assets = new Map<ContentAssetId, ContentAsset>();
  readonly #pages = new Map<PageId, PageAggregate>();
  readonly #endpoint_page_ids = new Map<string, PageId>();

  // deno-lint-ignore require-await
  async create_content_asset(
    asset: ContentAsset,
  ): Promise<CreateContentAssetResult> {
    const violation = content_asset_violation(asset);
    require(violation === null, violation ?? "invalid content asset");
    if (this.#assets.has(asset.content_asset_id)) {
      return { ok: false, reason: "content_asset_id_conflict" };
    }
    const stored = clone(asset);
    this.#assets.set(stored.content_asset_id, stored);
    return { ok: true, asset: clone(stored) };
  }

  // deno-lint-ignore require-await
  async find_content_asset_by_id(
    content_asset_id: ContentAssetId,
  ): Promise<ContentAsset | null> {
    require(
      is_valid_content_asset_id(content_asset_id),
      "content_asset_id must be a route-safe opaque id",
    );
    const asset = this.#assets.get(content_asset_id);
    return asset === undefined ? null : clone(asset);
  }

  // deno-lint-ignore require-await
  async find_page_aggregate_by_id(
    page_id: PageId,
  ): Promise<PageAggregate | null> {
    require(
      is_valid_page_id(page_id),
      "page_id must be a route-safe opaque id",
    );
    const page = this.#pages.get(page_id);
    return page === undefined ? null : clone(page);
  }

  // deno-lint-ignore require-await
  async resolve_page_endpoint(
    locator: Locator,
  ): Promise<ResolvedPageEndpoint | null> {
    const key = locator_key(locator);
    const page_id = this.#endpoint_page_ids.get(key);
    if (page_id === undefined) return null;
    const page = this.#pages.get(page_id);
    if (page === undefined) return this.#invariant_violation();
    const endpoint = page_aggregate_endpoint_bindings(page).find((binding) =>
      locator_key(binding.locator) === key
    );
    if (endpoint === undefined) return this.#invariant_violation();
    return clone({ page, endpoint });
  }

  // deno-lint-ignore require-await
  async put_trial_page_aggregate(
    request: PutTrialPageAggregateRequest,
  ): Promise<PutTrialPageAggregateResult> {
    this.#require_page_id(request.page_id);
    this.#require_endpoint_set(request.endpoint_set);
    this.#require_content_asset_id(request.content_asset_id);
    this.#require_time(request.now);

    const claimed_page_ids = this.#claimed_page_ids(request.endpoint_set);
    const claimed_trials = new Set<PageId>();
    for (const page_id of claimed_page_ids) {
      const page = this.#require_stored_page(page_id);
      if (page.stewardship.kind === "managed") {
        return { ok: false, reason: "managed_conflict" };
      }
      claimed_trials.add(page_id);
    }
    if (claimed_trials.size > 1) {
      return { ok: false, reason: "endpoint_conflict" };
    }
    if (!this.#assets.has(request.content_asset_id)) {
      return { ok: false, reason: "content_asset_not_found" };
    }

    const existing_id = claimed_trials.values().next().value as
      | PageId
      | undefined;
    if (existing_id === undefined && this.#pages.has(request.page_id)) {
      return { ok: false, reason: "page_id_conflict" };
    }
    const existing = existing_id === undefined
      ? null
      : this.#require_stored_page(existing_id);
    if (existing !== null && existing.revision === Number.MAX_SAFE_INTEGER) {
      return { ok: false, reason: "revision_exhausted" };
    }
    const page: PageAggregate = existing === null
      ? {
        page_id: request.page_id,
        endpoint_set: clone(request.endpoint_set),
        stewardship: { kind: "trial" },
        access: "public",
        tags: [],
        revision: 1,
        content_asset_id: request.content_asset_id,
        created_at: clone(request.now),
        updated_at: clone(request.now),
      }
      : {
        page_id: existing.page_id,
        endpoint_set: clone(request.endpoint_set),
        stewardship: { kind: "trial" },
        access: "public",
        tags: [],
        revision: existing.revision + 1,
        content_asset_id: request.content_asset_id,
        created_at: existing.created_at,
        updated_at: clone(request.now),
      };
    this.#assert_valid_page(page);
    if (existing !== null) this.#remove_page(existing);
    this.#install_page(page);
    return {
      ok: true,
      outcome: existing === null ? "created" : "replaced",
      page: clone(page),
    };
  }

  // deno-lint-ignore require-await
  async create_managed_page_aggregate(
    request: CreateManagedPageAggregateRequest,
  ): Promise<CreateManagedPageAggregateResult> {
    this.#require_page_id(request.page_id);
    this.#require_endpoint_set(request.endpoint_set);
    this.#require_owner(request.owner_user_id);
    require(
      is_valid_page_access(request.access),
      "access must be public or private",
    );
    require(
      is_valid_page_tags(request.tags ?? []),
      "tags must be a bounded canonical sorted unique set",
    );
    this.#require_content_asset_id(request.content_asset_id);
    this.#require_time(request.now);

    const claimed_trials = new Set<PageId>();
    for (const page_id of this.#claimed_page_ids(request.endpoint_set)) {
      const page = this.#require_stored_page(page_id);
      if (page.stewardship.kind === "managed") {
        return { ok: false, reason: "managed_conflict" };
      }
      claimed_trials.add(page_id);
    }
    if (this.#pages.has(request.page_id)) {
      return { ok: false, reason: "page_id_conflict" };
    }
    if (!this.#assets.has(request.content_asset_id)) {
      return { ok: false, reason: "content_asset_not_found" };
    }
    const page: PageAggregate = {
      page_id: request.page_id,
      endpoint_set: clone(request.endpoint_set),
      stewardship: { kind: "managed", owner_user_id: request.owner_user_id },
      access: request.access,
      tags: [...(request.tags ?? [])],
      revision: 1,
      content_asset_id: request.content_asset_id,
      created_at: clone(request.now),
      updated_at: clone(request.now),
    };
    this.#assert_valid_page(page);
    this.#retire_trials(claimed_trials);
    this.#install_page(page);
    return {
      ok: true,
      outcome: claimed_trials.size === 0 ? "created" : "replaced_trial",
      page: clone(page),
    };
  }

  // deno-lint-ignore require-await
  async update_managed_page_aggregate(
    request: UpdateManagedPageAggregateRequest,
  ): Promise<UpdateManagedPageAggregateResult> {
    this.#require_page_id(request.page_id);
    this.#require_owner(request.owner_user_id);
    require(
      is_valid_page_revision(request.expected_revision),
      "expected_revision must be a positive safe integer",
    );
    const has_patch = request.patch.endpoint_set !== undefined ||
      request.patch.content_asset_id !== undefined ||
      request.patch.access !== undefined || request.patch.tags !== undefined;
    require(has_patch, "patch must change at least one aggregate field");
    if (request.patch.endpoint_set !== undefined) {
      this.#require_endpoint_set(request.patch.endpoint_set);
    }
    if (request.patch.content_asset_id !== undefined) {
      this.#require_content_asset_id(request.patch.content_asset_id);
    }
    require(
      request.patch.access === undefined ||
        is_valid_page_access(request.patch.access),
      "access must be public or private when present",
    );
    require(
      request.patch.tags === undefined ||
        is_valid_page_tags(request.patch.tags),
      "tags must be a bounded canonical sorted unique set when present",
    );
    this.#require_time(request.now);

    const existing = this.#pages.get(request.page_id);
    if (
      existing === undefined || existing.stewardship.kind !== "managed" ||
      existing.stewardship.owner_user_id !== request.owner_user_id
    ) {
      return { ok: false, reason: "not_found" };
    }
    if (request.patch.endpoint_set !== undefined) {
      require(
        this.#endpoint_namespace_key(request.patch.endpoint_set) ===
          this.#endpoint_namespace_key(existing.endpoint_set),
        "endpoint replacement must stay within the current namespace",
      );
    }
    if (existing.revision !== request.expected_revision) {
      return { ok: false, reason: "revision_conflict" };
    }
    if (existing.revision === Number.MAX_SAFE_INTEGER) {
      return { ok: false, reason: "revision_exhausted" };
    }
    if (
      request.patch.content_asset_id !== undefined &&
      !this.#assets.has(request.patch.content_asset_id)
    ) {
      return { ok: false, reason: "content_asset_not_found" };
    }

    const endpoint_set = request.patch.endpoint_set ?? existing.endpoint_set;
    const claimed_trials = new Set<PageId>();
    if (request.patch.endpoint_set !== undefined) {
      for (const page_id of this.#claimed_page_ids(endpoint_set)) {
        if (page_id === existing.page_id) continue;
        const page = this.#require_stored_page(page_id);
        if (page.stewardship.kind === "managed") {
          return { ok: false, reason: "endpoint_conflict" };
        }
        claimed_trials.add(page_id);
      }
    }
    const page: PageAggregate = {
      ...existing,
      endpoint_set: clone(endpoint_set),
      access: request.patch.access ?? existing.access,
      tags: request.patch.tags === undefined
        ? existing.tags
        : clone(request.patch.tags),
      revision: existing.revision + 1,
      content_asset_id: request.patch.content_asset_id ??
        existing.content_asset_id,
      updated_at: clone(request.now),
    };
    this.#assert_valid_page(page);
    this.#remove_page(existing);
    this.#retire_trials(claimed_trials);
    this.#install_page(page);
    return {
      ok: true,
      outcome: claimed_trials.size === 0 ? "updated" : "replaced_trial",
      page: clone(page),
    };
  }

  // deno-lint-ignore require-await
  async duplicate_managed_page_aggregate(
    request: DuplicateManagedPageAggregateRequest,
  ): Promise<DuplicateManagedPageAggregateResult> {
    this.#require_page_id(request.source_page_id);
    this.#require_page_id(request.page_id);
    this.#require_owner(request.owner_user_id);
    require(
      is_valid_page_revision(request.expected_revision),
      "expected_revision must be a positive safe integer",
    );
    this.#require_endpoint_set(request.endpoint_set);
    this.#require_time(request.now);

    const source = this.#pages.get(request.source_page_id);
    if (
      source === undefined || source.stewardship.kind !== "managed" ||
      source.stewardship.owner_user_id !== request.owner_user_id
    ) {
      return { ok: false, reason: "not_found" };
    }
    require(
      this.#endpoint_namespace_key(request.endpoint_set) ===
        this.#endpoint_namespace_key(source.endpoint_set),
      "duplicate endpoints must stay within the source namespace",
    );
    if (source.revision !== request.expected_revision) {
      return { ok: false, reason: "revision_conflict" };
    }
    const claimed_trials = new Set<PageId>();
    for (const page_id of this.#claimed_page_ids(request.endpoint_set)) {
      const page = this.#require_stored_page(page_id);
      if (page.stewardship.kind === "managed") {
        return { ok: false, reason: "endpoint_conflict" };
      }
      claimed_trials.add(page_id);
    }
    if (this.#pages.has(request.page_id)) {
      return { ok: false, reason: "page_id_conflict" };
    }
    const page: PageAggregate = {
      page_id: request.page_id,
      endpoint_set: clone(request.endpoint_set),
      stewardship: clone(source.stewardship),
      access: source.access,
      tags: clone(source.tags),
      revision: 1,
      content_asset_id: source.content_asset_id,
      created_at: clone(request.now),
      updated_at: clone(request.now),
    };
    this.#assert_valid_page(page);
    this.#retire_trials(claimed_trials);
    this.#install_page(page);
    return {
      ok: true,
      outcome: claimed_trials.size === 0 ? "created" : "replaced_trial",
      page: clone(page),
    };
  }

  // deno-lint-ignore require-await
  async delete_managed_page_aggregate(
    request: DeleteManagedPageAggregateRequest,
  ): Promise<DeleteManagedPageAggregateResult> {
    this.#require_page_id(request.page_id);
    this.#require_owner(request.owner_user_id);
    require(
      is_valid_page_revision(request.expected_revision),
      "expected_revision must be a positive safe integer",
    );
    const existing = this.#pages.get(request.page_id);
    if (
      existing === undefined || existing.stewardship.kind !== "managed" ||
      existing.stewardship.owner_user_id !== request.owner_user_id
    ) {
      return { ok: false, reason: "not_found" };
    }
    if (existing.revision !== request.expected_revision) {
      return { ok: false, reason: "revision_conflict" };
    }
    this.#remove_page(existing);
    return { ok: true };
  }

  #endpoint_namespace_key(endpoint_set: PageEndpointSet): string {
    return endpoint_set.canonical.locator.namespace.toLowerCase();
  }

  #claimed_page_ids(endpoint_set: PageEndpointSet): Set<PageId> {
    const page_ids = new Set<PageId>();
    for (
      const binding of [endpoint_set.canonical, ...endpoint_set.alternates]
    ) {
      const page_id = this.#endpoint_page_ids.get(locator_key(binding.locator));
      if (page_id !== undefined) page_ids.add(page_id);
    }
    return page_ids;
  }

  #retire_trials(page_ids: ReadonlySet<PageId>): void {
    for (const page_id of page_ids) {
      const page = this.#require_stored_page(page_id);
      if (page.stewardship.kind !== "trial") this.#invariant_violation();
      this.#remove_page(page);
    }
  }

  #install_page(page: PageAggregate): void {
    if (this.#pages.has(page.page_id)) this.#invariant_violation();
    for (const binding of page_aggregate_endpoint_bindings(page)) {
      const key = locator_key(binding.locator);
      if (this.#endpoint_page_ids.has(key)) this.#invariant_violation();
      this.#endpoint_page_ids.set(key, page.page_id);
    }
    this.#pages.set(page.page_id, page);
  }

  #remove_page(page: PageAggregate): void {
    if (this.#pages.get(page.page_id) !== page) this.#invariant_violation();
    for (const binding of page_aggregate_endpoint_bindings(page)) {
      const key = locator_key(binding.locator);
      if (this.#endpoint_page_ids.get(key) !== page.page_id) {
        this.#invariant_violation();
      }
      this.#endpoint_page_ids.delete(key);
    }
    this.#pages.delete(page.page_id);
  }

  #require_stored_page(page_id: PageId): PageAggregate {
    const page = this.#pages.get(page_id);
    return page ?? this.#invariant_violation();
  }

  #assert_valid_page(page: PageAggregate): void {
    const violation = page_aggregate_violation(page);
    require(violation === null, violation ?? "invalid page aggregate");
    require(
      this.#assets.has(page.content_asset_id),
      "page must reference a stored content asset",
    );
  }

  #require_page_id(page_id: PageId): void {
    require(
      is_valid_page_id(page_id),
      "page_id must be a route-safe opaque id",
    );
  }

  #require_content_asset_id(content_asset_id: ContentAssetId): void {
    require(
      is_valid_content_asset_id(content_asset_id),
      "content_asset_id must be a route-safe opaque id",
    );
  }

  #require_endpoint_set(endpoint_set: PageEndpointSet): void {
    const violation = page_endpoint_set_violation(endpoint_set);
    require(violation === null, violation ?? "invalid endpoint set");
  }

  #require_owner(owner_user_id: string): void {
    require(
      typeof owner_user_id === "string" && owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
  }

  #require_time(now: Date): void {
    require(is_valid_time(now), "now must be a valid date");
  }

  #invariant_violation(): never {
    throw new Error("page aggregate repository invariant violated");
  }
}
