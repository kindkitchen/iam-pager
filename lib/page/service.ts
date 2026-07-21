import {
  type ContentAsset,
  type ContentAssetId,
  is_valid_content_asset_id,
} from "../content/asset.ts";
import { CryptoContentAssetIdGenerator } from "../content/generators.ts";
import type {
  ContentAssetIdGenerator,
  ContentTypeHandler,
} from "../content/interfaces.ts";
import type { ContentMeta, DeliveryPayload } from "../content/model.ts";
import type { LocatorEngine } from "../locator/engine.ts";
import type { Locator } from "../locator/model.ts";
import {
  FourWordRandomNameGenerator,
  type RandomNameGenerator,
} from "../random-name.ts";
import { page_aggregate_violation, type PageAggregate } from "./aggregate.ts";
import type { PageAggregateRepository } from "./aggregate-interfaces.ts";
import {
  DefaultPageEndpointPlanner,
  type PageEndpointBinding,
  type PageEndpointPlanner,
  type PageEndpointSet,
  type PageEndpointSetIntent,
  project_page_endpoint_links,
} from "./endpoint.ts";
import {
  max_bulk_managed_pages,
  max_managed_page_name_query_length,
  max_public_exploration_query_length,
} from "./interfaces.ts";
import type {
  BulkChangeManagedPageAccessItemResult,
  BulkChangeManagedPageAccessRequest,
  BulkChangeManagedPageAccessResult,
  BulkDeleteManagedPageItemResult,
  BulkDeleteManagedPagesRequest,
  BulkDeleteManagedPagesResult,
  CreateManagedPageRequest,
  CreateManagedPageResult,
  DeleteManagedPageRequest,
  DeleteManagedPageResult,
  DuplicateManagedPageRequest,
  DuplicateManagedPageResult,
  ExplorePublicPagesRequest,
  ExplorePublicPagesResult,
  InspectManagedPageRequest,
  InspectManagedPageResult,
  ListManagedPagesRequest,
  ListManagedPagesResult,
  ListPublicPagesRequest,
  ListPublicPagesResult,
  ManagedPageBulkAccessChanger,
  ManagedPageBulkDeleter,
  ManagedPageCreator,
  ManagedPageDeleter,
  ManagedPageDuplicator,
  ManagedPageInspection,
  ManagedPageInspector,
  ManagedPageLister,
  ManagedPageRenamer,
  ManagedPageRevisionSelection,
  ManagedPageUpdater,
  NamespaceAuthorityResolver,
  PageClock,
  PageContentCommand,
  PageDeliverer,
  PageEndpointCommandFailureReason,
  PageIdGenerator,
  PageSummary,
  PublicPageExplorer,
  PublicPageLister,
  PublicPageSummary,
  PublicPageViewer,
  PublishTrialPageRequest,
  PublishTrialPageResult,
  RenameManagedPageRequest,
  RenameManagedPageResult,
  TrialPagePublisher,
  UpdateManagedPageRequest,
  UpdateManagedPageResult,
  UserPageActor,
  ViewPublicPageResult,
} from "./interfaces.ts";
import {
  is_valid_page_access,
  is_valid_page_id,
  is_valid_page_revision,
  normalize_page_tag,
  normalize_page_tags,
  type PageContent,
} from "./model.ts";
import { CryptoPageIdGenerator, SystemPageClock } from "./generators.ts";

export interface PageServiceOptions {
  engine: LocatorEngine;
  /** Logical page, endpoint, and content persistence. */
  repository: PageAggregateRepository;
  namespace_authority: NamespaceAuthorityResolver;
  handlers: readonly ContentTypeHandler<unknown, unknown>[];
  page_id_generator?: PageIdGenerator;
  content_asset_id_generator?: ContentAssetIdGenerator;
  endpoint_planner?: PageEndpointPlanner;
  clock?: PageClock;
  /** Bounded retries for generated-id collisions. Defaults to 3. */
  max_page_id_attempts?: number;
  /** Server-owned generator for duplicate page names. */
  page_name_generator?: RandomNameGenerator;
  /** Bounded generated-name attempts for duplication. Defaults to 16. */
  max_page_name_attempts?: number;
}

type ContentPreparationResult =
  | { ok: true; content: PageContent }
  | { ok: false; reason: "unknown_content_type" }
  | { ok: false; reason: "invalid_input"; detail: string };

type EndpointPreparationResult =
  | { ok: true; endpoint_set: PageEndpointSet }
  | {
    ok: false;
    reason:
      | PageEndpointCommandFailureReason
      | "endpoint_capacity_exceeded"
      | "unknown_content_type";
  };

type MaterializedPage = PageAggregate & { readonly content: PageContent };

type MaterializedPageMutationResult<
  Outcome extends string,
  Failure extends string,
> =
  | { ok: true; outcome: Outcome; page: MaterializedPage }
  | { ok: false; reason: Failure };

type MaterializedPageUpdateResult =
  | { ok: true; page: MaterializedPage }
  | {
    ok: false;
    reason:
      | "not_found"
      | "revision_conflict"
      | "endpoint_conflict"
      | "endpoint_capacity_exceeded";
  };

type MaterializedPageListResult =
  | { ok: true; pages: MaterializedPage[]; next_cursor: string | null }
  | { ok: false; reason: "invalid_cursor" };

/**
 * HTTP/session-independent page application layer. It
 * is the only valid producer of page content and always applies validate ->
 * derive -> render -> metadata before storage. Namespace authority is resolved
 * through an interface and every conditional managed mutation remains
 * revision-bound in the repository.
 */
export class PageService
  implements
    TrialPagePublisher,
    ManagedPageCreator,
    ManagedPageLister,
    ManagedPageInspector,
    ManagedPageUpdater,
    ManagedPageDeleter,
    ManagedPageBulkAccessChanger,
    ManagedPageBulkDeleter,
    ManagedPageRenamer,
    ManagedPageDuplicator,
    PublicPageViewer,
    PublicPageLister,
    PublicPageExplorer,
    PageDeliverer {
  readonly #engine: LocatorEngine;
  readonly #repository: PageAggregateRepository;
  readonly #namespace_authority: NamespaceAuthorityResolver;
  readonly #handlers = new Map<
    string,
    ContentTypeHandler<unknown, unknown>
  >();
  readonly #page_id_generator: PageIdGenerator;
  readonly #content_asset_id_generator: ContentAssetIdGenerator;
  readonly #endpoint_planner: PageEndpointPlanner;
  readonly #clock: PageClock;
  readonly #max_page_id_attempts: number;
  readonly #page_name_generator: RandomNameGenerator;
  readonly #max_page_name_attempts: number;

  constructor(options: PageServiceOptions) {
    for (const handler of options.handlers) {
      if (handler.content_type === "") {
        throw new Error("content type must be non-empty");
      }
      if (this.#handlers.has(handler.content_type)) {
        throw new Error(`duplicate content type: ${handler.content_type}`);
      }
      this.#handlers.set(handler.content_type, handler);
    }
    const max_page_id_attempts = options.max_page_id_attempts ?? 3;
    if (
      !Number.isSafeInteger(max_page_id_attempts) || max_page_id_attempts < 1
    ) {
      throw new Error("max_page_id_attempts must be a positive safe integer");
    }
    this.#engine = options.engine;
    this.#repository = options.repository;
    this.#namespace_authority = options.namespace_authority;
    this.#page_id_generator = options.page_id_generator ??
      new CryptoPageIdGenerator();
    this.#content_asset_id_generator = options.content_asset_id_generator ??
      new CryptoContentAssetIdGenerator();
    this.#endpoint_planner = options.endpoint_planner ??
      new DefaultPageEndpointPlanner(options.engine);
    this.#clock = options.clock ?? new SystemPageClock();
    const max_page_name_attempts = options.max_page_name_attempts ?? 16;
    if (
      !Number.isSafeInteger(max_page_name_attempts) ||
      max_page_name_attempts < 1
    ) {
      throw new Error("max_page_name_attempts must be a positive safe integer");
    }
    this.#max_page_id_attempts = max_page_id_attempts;
    this.#page_name_generator = options.page_name_generator ??
      new FourWordRandomNameGenerator();
    this.#max_page_name_attempts = max_page_name_attempts;
  }

  async publish_trial(
    request: PublishTrialPageRequest,
  ): Promise<PublishTrialPageResult> {
    this.#require_guest(request.actor);
    const endpoints = this.#prepare_endpoint_command(
      request,
      request.content.content_type,
    );
    if (!endpoints.ok) return endpoints;
    if (!is_valid_page_access(request.access)) {
      return { ok: false, reason: "invalid_access" };
    }
    if (request.access === "private") {
      return { ok: false, reason: "private_requires_managed_page" };
    }
    const authorities = await this.#endpoint_authorities(
      request.actor,
      endpoints.endpoint_set,
    );
    if (authorities.some((authority) => authority !== "unreserved")) {
      return { ok: false, reason: "namespace_reserved" };
    }
    const prepared = this.#prepare_content(request.content);
    if (!prepared.ok) return prepared;
    const now = this.#operation_time();
    for (let attempt = 0; attempt < this.#max_page_id_attempts; attempt++) {
      const page_id = this.#generate_page_id();
      const result = await this.#put_trial({
        page_id,
        endpoint_set: endpoints.endpoint_set,
        content: prepared.content,
        now,
      });
      if (result.ok) {
        return {
          ok: true,
          outcome: result.outcome,
          page: this.#summary(result.page),
        };
      }
      if (result.reason === "managed_conflict") {
        // A reservation/managed create may have won after authority lookup.
        return { ok: false, reason: "namespace_reserved" };
      }
      if (
        result.reason === "endpoint_conflict" ||
        result.reason === "endpoint_capacity_exceeded" ||
        result.reason === "revision_exhausted"
      ) {
        return { ok: false, reason: result.reason };
      }
    }
    return { ok: false, reason: "page_id_generation_exhausted" };
  }

  async create_managed(
    request: CreateManagedPageRequest,
  ): Promise<CreateManagedPageResult> {
    this.#require_user(request.actor);
    const endpoints = this.#prepare_endpoint_command(
      request,
      request.content.content_type,
    );
    if (!endpoints.ok) return endpoints;
    if (!is_valid_page_access(request.access)) {
      return { ok: false, reason: "invalid_access" };
    }
    const tags = normalize_page_tags(request.tags ?? []);
    if (tags === null) return { ok: false, reason: "invalid_tags" };
    const authority_failure = await this.#managed_endpoint_authority_failure(
      request.actor,
      endpoints.endpoint_set,
    );
    if (authority_failure !== null) {
      return { ok: false, reason: authority_failure };
    }
    const prepared = this.#prepare_content(request.content);
    if (!prepared.ok) return prepared;
    const now = this.#operation_time();
    for (let attempt = 0; attempt < this.#max_page_id_attempts; attempt++) {
      const page_id = this.#generate_page_id();
      const result = await this.#create_managed_record({
        page_id,
        endpoint_set: endpoints.endpoint_set,
        owner_user_id: request.actor.user_id,
        access: request.access,
        tags,
        content: prepared.content,
        now,
      });
      if (result.ok) {
        return {
          ok: true,
          outcome: result.outcome,
          page: this.#summary(result.page),
        };
      }
      if (result.reason === "managed_conflict") {
        return { ok: false, reason: "page_exists" };
      }
      if (result.reason === "endpoint_capacity_exceeded") {
        return { ok: false, reason: "endpoint_capacity_exceeded" };
      }
    }
    return { ok: false, reason: "page_id_generation_exhausted" };
  }

  async list_managed(
    request: ListManagedPagesRequest,
  ): Promise<ListManagedPagesResult> {
    this.#require_user(request.actor);
    let namespace: string | undefined;
    if (request.namespace !== undefined) {
      const validation = this.#engine.validate({
        namespace: request.namespace,
      });
      if (!validation.ok) {
        return {
          ok: false,
          reason: validation.reason === "forbidden_namespace"
            ? "forbidden_namespace"
            : "invalid_namespace",
        };
      }
      const authority = await this.#namespace_authority.resolve(
        request.actor,
        request.namespace,
      );
      if (authority.kind !== "owned") {
        return { ok: false, reason: "namespace_not_owned" };
      }
      namespace = validation.locator.namespace;
    }
    const page_name_query = normalize_optional_query(
      request.page_name_query,
      max_managed_page_name_query_length,
    );
    const tag = normalize_tag_filter(request.tag);
    if (
      page_name_query === null || tag === null ||
      (request.access !== undefined && !is_valid_page_access(request.access))
    ) {
      return { ok: false, reason: "invalid_filter" };
    }
    const listed = await this.#materialize_list(
      this.#repository.list_managed_page_aggregates({
        owner_user_id: request.actor.user_id,
        ...(namespace === undefined ? {} : { namespace }),
        ...(page_name_query === undefined ? {} : { page_name_query }),
        ...(request.access === undefined ? {} : { access: request.access }),
        ...(tag === undefined ? {} : { tag }),
        limit: request.limit,
        cursor: request.cursor,
      }),
    );
    if (!listed.ok) return listed;
    return {
      ok: true,
      pages: listed.pages.map((page) => this.#summary(page)),
      next_cursor: listed.next_cursor,
    };
  }

  async inspect_managed(
    request: InspectManagedPageRequest,
  ): Promise<InspectManagedPageResult> {
    this.#require_user(request.actor);
    const page = await this.#find_authorized_page(
      request.actor,
      request.page_id,
    );
    if (page === null) return { ok: false, reason: "not_found" };
    return { ok: true, page: this.#inspection(page) };
  }

  async update_managed(
    request: UpdateManagedPageRequest,
  ): Promise<UpdateManagedPageResult> {
    this.#require_user(request.actor);
    if (!is_valid_page_revision(request.expected_revision)) {
      throw new Error("expected_revision must be a positive safe integer");
    }
    const has_access = request.patch.access !== undefined;
    const has_tags = request.patch.tags !== undefined;
    const has_content = request.patch.content !== undefined;
    const has_endpoints = request.patch.endpoint_set !== undefined;
    if (!has_access && !has_tags && !has_content && !has_endpoints) {
      return { ok: false, reason: "empty_patch" };
    }
    if (has_access && !is_valid_page_access(request.patch.access)) {
      return { ok: false, reason: "invalid_access" };
    }
    const tags = has_tags ? normalize_page_tags(request.patch.tags) : undefined;
    if (tags === null) return { ok: false, reason: "invalid_tags" };
    const page = await this.#find_authorized_page(
      request.actor,
      request.page_id,
    );
    if (page === null) return { ok: false, reason: "not_found" };
    if (page.revision !== request.expected_revision) {
      return { ok: false, reason: "revision_conflict" };
    }
    if (page.revision === Number.MAX_SAFE_INTEGER) {
      return { ok: false, reason: "revision_exhausted" };
    }
    this.#require_handler(page.content.content_type);
    let content: PageContent | undefined;
    if (request.patch.content !== undefined) {
      const prepared = this.#prepare_content(request.patch.content);
      if (!prepared.ok) return prepared;
      content = prepared.content;
    }

    const current_endpoint_set = this.#endpoint_set(page);
    let endpoint_set: PageEndpointSet | undefined;
    if (has_endpoints || content !== undefined) {
      const planned = this.#prepare_endpoint_intent(
        request.patch.endpoint_set ?? current_endpoint_set,
        content?.content_type ?? page.content.content_type,
      );
      if (!planned.ok) return planned;
      if (has_endpoints) {
        const authority_failure = await this
          .#managed_endpoint_authority_failure(
            request.actor,
            planned.endpoint_set,
          );
        if (authority_failure !== null) {
          return { ok: false, reason: authority_failure };
        }
      }
      if (
        !page_endpoint_sets_equal(planned.endpoint_set, current_endpoint_set)
      ) {
        endpoint_set = planned.endpoint_set;
      }
    }
    if (
      has_endpoints && endpoint_set === undefined && !has_access && !has_tags &&
      !has_content
    ) {
      return { ok: true, page: this.#inspection(page) };
    }

    const replaced = await this.#replace_managed_record({
      page_id: page.page_id,
      owner_user_id: request.actor.user_id,
      expected_revision: request.expected_revision,
      access: request.patch.access ?? page.access,
      tags,
      content,
      endpoint_set,
      now: this.#operation_time(),
    });
    if (!replaced.ok) {
      if (replaced.reason === "endpoint_conflict") {
        return { ok: false, reason: "page_exists" };
      }
      return { ok: false, reason: replaced.reason };
    }
    return { ok: true, page: this.#inspection(replaced.page) };
  }

  async bulk_change_managed_access(
    request: BulkChangeManagedPageAccessRequest,
  ): Promise<BulkChangeManagedPageAccessResult> {
    this.#require_user(request.actor);
    if (!is_valid_page_access(request.access)) {
      return { ok: false, reason: "invalid_access" };
    }
    if (!is_valid_bulk_selection(request.selection)) {
      return { ok: false, reason: "invalid_selection" };
    }

    const results: BulkChangeManagedPageAccessItemResult[] = [];
    let now: Date | undefined;
    for (const selected of request.selection) {
      const page = await this.#find_authorized_page(
        request.actor,
        selected.page_id,
      );
      if (page === null) {
        results.push({
          page_id: selected.page_id,
          ok: false,
          reason: "not_found",
        });
        continue;
      }
      if (page.revision !== selected.expected_revision) {
        results.push({
          page_id: selected.page_id,
          ok: false,
          reason: "revision_conflict",
        });
        continue;
      }
      if (page.revision === Number.MAX_SAFE_INTEGER) {
        results.push({
          page_id: selected.page_id,
          ok: false,
          reason: "revision_exhausted",
        });
        continue;
      }
      now ??= this.#operation_time();
      const replaced = await this.#replace_managed_record({
        page_id: page.page_id,
        owner_user_id: request.actor.user_id,
        expected_revision: selected.expected_revision,
        access: request.access,
        now,
      });
      if (!replaced.ok) {
        if (
          replaced.reason === "endpoint_conflict" ||
          replaced.reason === "endpoint_capacity_exceeded"
        ) {
          throw new Error(
            "page service persistence: access-only update changed endpoints",
          );
        }
        results.push({
          page_id: selected.page_id,
          ok: false,
          reason: replaced.reason,
        });
        continue;
      }
      results.push({
        page_id: selected.page_id,
        ok: true,
        page: this.#summary(replaced.page),
      });
    }
    return { ok: true, results };
  }

  async rename_managed(
    request: RenameManagedPageRequest,
  ): Promise<RenameManagedPageResult> {
    this.#require_user(request.actor);
    if (!is_valid_page_revision(request.expected_revision)) {
      throw new Error("expected_revision must be a positive safe integer");
    }
    const existing = await this.#find_authorized_page(
      request.actor,
      request.page_id,
    );
    if (existing === null) return { ok: false, reason: "not_found" };
    if (existing.revision !== request.expected_revision) {
      return { ok: false, reason: "revision_conflict" };
    }
    const current_inspection = this.#inspection(existing);
    const current_locator = existing.endpoint_set.canonical.locator;
    const locator: Locator = request.page_name === undefined
      ? { namespace: current_locator.namespace }
      : { namespace: current_locator.namespace, page_name: request.page_name };
    if (current_locator.page_name === locator.page_name) {
      return {
        ok: true,
        outcome: "unchanged",
        page: current_inspection,
      };
    }
    const current_endpoint_set = this.#endpoint_set(existing);
    const planned = this.#prepare_endpoint_intent({
      canonical: {
        locator,
        delivery_profile: current_endpoint_set.canonical.delivery_profile,
      },
      alternates: current_endpoint_set.alternates,
    }, existing.content.content_type);
    if (!planned.ok) {
      if (planned.reason === "duplicate_locator") {
        return { ok: false, reason: "page_exists" };
      }
      if (planned.reason === "invalid_locator") {
        return { ok: false, reason: "invalid_page_name" };
      }
      throw new Error(`stored page endpoint invariant: ${planned.reason}`);
    }
    if (existing.revision === Number.MAX_SAFE_INTEGER) {
      return { ok: false, reason: "revision_exhausted" };
    }
    const renamed = await this.#rename_managed_record({
      page_id: existing.page_id,
      owner_user_id: request.actor.user_id,
      expected_revision: request.expected_revision,
      endpoint_set: planned.endpoint_set,
      now: this.#operation_time(),
    });
    if (!renamed.ok) {
      if (renamed.reason === "locator_conflict") {
        return { ok: false, reason: "page_exists" };
      }
      return { ok: false, reason: renamed.reason };
    }
    return {
      ok: true,
      outcome: renamed.outcome,
      page: this.#inspection(renamed.page),
    };
  }

  async duplicate_managed(
    request: DuplicateManagedPageRequest,
  ): Promise<DuplicateManagedPageResult> {
    this.#require_user(request.actor);
    if (!is_valid_page_revision(request.expected_revision)) {
      throw new Error("expected_revision must be a positive safe integer");
    }
    const source = await this.#find_authorized_page(
      request.actor,
      request.page_id,
    );
    if (source === null) return { ok: false, reason: "not_found" };
    if (source.revision !== request.expected_revision) {
      return { ok: false, reason: "revision_conflict" };
    }
    const handler = this.#require_handler(source.content.content_type);
    const source_locator = source.endpoint_set.canonical.locator;

    if (request.endpoint_set !== undefined) {
      const planned = this.#prepare_endpoint_intent(
        request.endpoint_set,
        source.content.content_type,
      );
      if (!planned.ok) {
        if (planned.reason === "unknown_content_type") {
          throw new Error("stored page content type has no handler");
        }
        return { ok: false, reason: planned.reason };
      }
      const authority_failure = await this.#managed_endpoint_authority_failure(
        request.actor,
        planned.endpoint_set,
      );
      if (authority_failure !== null) {
        return { ok: false, reason: authority_failure };
      }
      const now = this.#operation_time();
      for (
        let id_attempt = 0;
        id_attempt < this.#max_page_id_attempts;
        id_attempt += 1
      ) {
        const duplicated = await this.#duplicate_managed_record({
          source_page_id: source.page_id,
          owner_user_id: request.actor.user_id,
          expected_revision: request.expected_revision,
          page_id: this.#generate_page_id(),
          endpoint_set: planned.endpoint_set,
          now,
        });
        if (duplicated.ok) {
          return {
            ok: true,
            outcome: duplicated.outcome,
            page: this.#inspection(duplicated.page),
          };
        }
        if (
          duplicated.reason === "not_found" ||
          duplicated.reason === "revision_conflict"
        ) {
          return { ok: false, reason: duplicated.reason };
        }
        if (duplicated.reason === "locator_conflict") {
          return { ok: false, reason: "page_exists" };
        }
        if (duplicated.reason === "endpoint_capacity_exceeded") {
          return { ok: false, reason: "endpoint_capacity_exceeded" };
        }
      }
      return { ok: false, reason: "page_id_generation_exhausted" };
    }

    const source_endpoint_set = this.#endpoint_set(source);
    if (
      source_endpoint_set.alternates.length !== 0 ||
      source_endpoint_set.canonical.delivery_profile !== "inline" ||
      handler.supported_delivery_profiles.length !== 1 ||
      handler.supported_delivery_profiles[0] !== "inline"
    ) {
      return { ok: false, reason: "endpoint_set_required" };
    }

    const now = this.#operation_time();
    const used_names = new Set<string>();
    if (source_locator.page_name !== undefined) {
      used_names.add(source_locator.page_name.toLowerCase());
    }
    for (
      let name_attempt = 0;
      name_attempt < this.#max_page_name_attempts;
      name_attempt += 1
    ) {
      const page_name = this.#page_name_generator.generate(used_names);
      const normalized_name = page_name.toLowerCase();
      if (used_names.has(normalized_name)) {
        throw new Error("RandomNameGenerator repeated a used page name");
      }
      const locator = { namespace: source_locator.namespace, page_name };
      if (!this.#engine.validate(locator).ok) {
        throw new Error("RandomNameGenerator produced an invalid page name");
      }
      used_names.add(normalized_name);
      let name_conflict = false;
      for (
        let id_attempt = 0;
        id_attempt < this.#max_page_id_attempts;
        id_attempt += 1
      ) {
        const page_id = this.#generate_page_id();
        const duplicated = await this.#duplicate_managed_record({
          source_page_id: source.page_id,
          owner_user_id: request.actor.user_id,
          expected_revision: request.expected_revision,
          page_id,
          endpoint_set: this.#canonical_inline_endpoint_set(
            locator,
            source.content.content_type,
          ),
          now,
        });
        if (duplicated.ok) {
          return {
            ok: true,
            outcome: duplicated.outcome,
            page: this.#inspection(duplicated.page),
          };
        }
        if (duplicated.reason === "not_found") {
          return { ok: false, reason: "not_found" };
        }
        if (duplicated.reason === "revision_conflict") {
          return { ok: false, reason: "revision_conflict" };
        }
        if (duplicated.reason === "locator_conflict") {
          name_conflict = true;
          break;
        }
        if (duplicated.reason === "endpoint_capacity_exceeded") {
          return { ok: false, reason: "endpoint_capacity_exceeded" };
        }
      }
      if (!name_conflict) {
        return { ok: false, reason: "page_id_generation_exhausted" };
      }
    }
    return { ok: false, reason: "page_name_generation_exhausted" };
  }

  async delete_managed(
    request: DeleteManagedPageRequest,
  ): Promise<DeleteManagedPageResult> {
    this.#require_user(request.actor);
    if (!is_valid_page_revision(request.expected_revision)) {
      throw new Error("expected_revision must be a positive safe integer");
    }
    const page = await this.#find_authorized_page(
      request.actor,
      request.page_id,
    );
    if (page === null) return { ok: false, reason: "not_found" };
    return await this.#repository.delete_managed_page_aggregate({
      page_id: page.page_id,
      owner_user_id: request.actor.user_id,
      expected_revision: request.expected_revision,
    });
  }

  async bulk_delete_managed(
    request: BulkDeleteManagedPagesRequest,
  ): Promise<BulkDeleteManagedPagesResult> {
    this.#require_user(request.actor);
    if (!is_valid_bulk_selection(request.selection)) {
      return { ok: false, reason: "invalid_selection" };
    }

    const results: BulkDeleteManagedPageItemResult[] = [];
    for (const selected of request.selection) {
      const page = await this.#find_authorized_page(
        request.actor,
        selected.page_id,
      );
      if (page === null) {
        results.push({
          page_id: selected.page_id,
          ok: false,
          reason: "not_found",
        });
        continue;
      }
      const deleted = await this.#repository.delete_managed_page_aggregate({
        page_id: page.page_id,
        owner_user_id: request.actor.user_id,
        expected_revision: selected.expected_revision,
      });
      results.push(
        deleted.ok ? { page_id: selected.page_id, ok: true } : {
          page_id: selected.page_id,
          ok: false,
          reason: deleted.reason,
        },
      );
    }
    return { ok: true, results };
  }

  async view_public(locator: Locator): Promise<ViewPublicPageResult> {
    if (!this.#engine.validate(locator).ok) {
      return { ok: false, reason: "not_found" };
    }
    const page = await this.#find_public_record_by_locator(locator);
    if (page === null || page.access !== "public") {
      // Missing, private, and incoherent pages are indistinguishable to
      // visitors.
      return { ok: false, reason: "not_found" };
    }
    const handler = this.#handlers.get(page.content.content_type);
    if (handler === undefined) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      page: this.#public_summary(page),
      payload: handler.render(page.content.data),
    };
  }

  async list_public(
    request: ListPublicPagesRequest,
  ): Promise<ListPublicPagesResult> {
    const validation = this.#engine.validate({ namespace: request.namespace });
    if (!validation.ok) {
      return {
        ok: false,
        reason: validation.reason === "forbidden_namespace"
          ? "forbidden_namespace"
          : "invalid_namespace",
      };
    }
    const listed = await this.#materialize_list(
      this.#repository.list_public_page_aggregates({
        namespace: validation.locator.namespace,
        limit: request.limit,
        cursor: request.cursor,
      }),
    );
    if (!listed.ok) return listed;
    return {
      ok: true,
      pages: listed.pages.map((page) => this.#public_summary(page)),
      next_cursor: listed.next_cursor,
    };
  }

  async explore_public(
    request: ExplorePublicPagesRequest,
  ): Promise<ExplorePublicPagesResult> {
    const namespace_query = normalize_exploration_query(
      request.namespace_query,
    );
    const page_name_query = normalize_exploration_query(
      request.page_name_query,
    );
    const tag = normalize_tag_filter(request.tag);
    if (namespace_query === null || page_name_query === null || tag === null) {
      return { ok: false, reason: "invalid_query" };
    }
    const explored = await this.#materialize_list(
      this.#repository.explore_public_page_aggregates({
        ...(namespace_query === undefined ? {} : { namespace_query }),
        ...(page_name_query === undefined ? {} : { page_name_query }),
        ...(tag === undefined ? {} : { tag }),
        limit: request.limit,
        cursor: request.cursor,
      }),
    );
    if (!explored.ok) return explored;
    return {
      ok: true,
      pages: explored.pages.map((page) => this.#public_summary(page)),
      next_cursor: explored.next_cursor,
    };
  }

  async deliver(
    locator: Locator,
    actor: { kind: "guest" } | UserPageActor,
  ) {
    const resolved = await this.#resolve_delivery_record(locator, actor);
    if (!resolved.ok) return resolved;
    const page = resolved.page;
    const handler = this.#handlers.get(page.content.content_type);
    if (handler === undefined) {
      return { ok: false as const, reason: "corrupt" as const };
    }
    if (
      !handler.supported_delivery_profiles.includes(
        resolved.endpoint.delivery_profile,
      )
    ) {
      return { ok: false as const, reason: "corrupt" as const };
    }
    return {
      ok: true as const,
      page: {
        page_id: page.page_id,
        revision: page.revision,
        size_bytes: page.content.meta.size_bytes,
      },
      endpoint: project_page_endpoint_links(
        { canonical: resolved.endpoint, alternates: [] },
        this.#engine,
      ).canonical,
      payload: handler.render(page.content.data),
    };
  }

  async #put_trial(request: {
    page_id: string;
    endpoint_set: PageEndpointSet;
    content: PageContent;
    now: Date;
  }): Promise<
    MaterializedPageMutationResult<
      "created" | "replaced",
      | "managed_conflict"
      | "endpoint_conflict"
      | "page_id_conflict"
      | "endpoint_capacity_exceeded"
      | "revision_exhausted"
    >
  > {
    const content_asset_id = await this.#stage_content_asset(
      request.content,
      request.now,
    );
    const result = await this.#repository.put_trial_page_aggregate({
      page_id: request.page_id,
      endpoint_set: request.endpoint_set,
      content_asset_id,
      now: request.now,
    });
    if (!result.ok) {
      if (
        result.reason === "managed_conflict" ||
        result.reason === "endpoint_conflict" ||
        result.reason === "endpoint_capacity_exceeded" ||
        result.reason === "revision_exhausted" ||
        result.reason === "page_id_conflict"
      ) {
        return { ok: false as const, reason: result.reason };
      }
      throw new Error(`page service persistence: ${result.reason}`);
    }
    return {
      ok: true as const,
      outcome: result.outcome,
      page: await this.#materialize_aggregate(result.page),
    };
  }

  async #create_managed_record(request: {
    page_id: string;
    endpoint_set: PageEndpointSet;
    owner_user_id: string;
    access: "public" | "private";
    tags: readonly string[];
    content: PageContent;
    now: Date;
  }): Promise<
    MaterializedPageMutationResult<
      "created" | "replaced_trial",
      "managed_conflict" | "page_id_conflict" | "endpoint_capacity_exceeded"
    >
  > {
    const content_asset_id = await this.#stage_content_asset(
      request.content,
      request.now,
    );
    const result = await this.#repository.create_managed_page_aggregate({
      page_id: request.page_id,
      endpoint_set: request.endpoint_set,
      owner_user_id: request.owner_user_id,
      access: request.access,
      tags: request.tags,
      content_asset_id,
      now: request.now,
    });
    if (!result.ok) {
      if (
        result.reason === "managed_conflict" ||
        result.reason === "endpoint_capacity_exceeded"
      ) {
        return { ok: false, reason: result.reason };
      }
      return { ok: false, reason: "page_id_conflict" };
    }
    return {
      ok: true,
      outcome: result.outcome,
      page: await this.#materialize_aggregate(result.page),
    };
  }

  async #materialize_list(
    pending: Promise<
      | { ok: true; pages: PageAggregate[]; next_cursor: string | null }
      | { ok: false; reason: "invalid_cursor" }
    >,
  ): Promise<MaterializedPageListResult> {
    const result = await pending;
    if (!result.ok) return result;
    return {
      ...result,
      pages: await Promise.all(
        result.pages.map((page) => this.#materialize_aggregate(page)),
      ),
    };
  }

  async #replace_managed_record(request: {
    page_id: string;
    owner_user_id: string;
    expected_revision: number;
    access: "public" | "private";
    tags?: readonly string[];
    content?: PageContent;
    endpoint_set?: PageEndpointSet;
    now: Date;
  }): Promise<MaterializedPageUpdateResult> {
    const content_asset_id = request.content === undefined
      ? undefined
      : await this.#stage_content_asset(request.content, request.now);
    const result = await this.#repository.update_managed_page_aggregate({
      page_id: request.page_id,
      owner_user_id: request.owner_user_id,
      expected_revision: request.expected_revision,
      patch: {
        access: request.access,
        ...(request.tags === undefined ? {} : { tags: request.tags }),
        ...(content_asset_id === undefined ? {} : { content_asset_id }),
        ...(request.endpoint_set === undefined
          ? {}
          : { endpoint_set: request.endpoint_set }),
      },
      now: request.now,
    });
    if (!result.ok) {
      if (
        result.reason === "not_found" ||
        result.reason === "revision_conflict" ||
        result.reason === "endpoint_conflict" ||
        result.reason === "endpoint_capacity_exceeded"
      ) {
        return { ok: false as const, reason: result.reason };
      }
      throw new Error(`page service persistence: ${result.reason}`);
    }
    return {
      ok: true as const,
      page: await this.#materialize_aggregate(result.page),
    };
  }

  async #rename_managed_record(request: {
    page_id: string;
    owner_user_id: string;
    expected_revision: number;
    endpoint_set: PageEndpointSet;
    now: Date;
  }): Promise<
    MaterializedPageMutationResult<
      "renamed" | "replaced_trial",
      "not_found" | "revision_conflict" | "locator_conflict"
    >
  > {
    const result = await this.#repository.update_managed_page_aggregate({
      page_id: request.page_id,
      owner_user_id: request.owner_user_id,
      expected_revision: request.expected_revision,
      patch: { endpoint_set: request.endpoint_set },
      now: request.now,
    });
    if (!result.ok) {
      if (result.reason === "endpoint_conflict") {
        return { ok: false, reason: "locator_conflict" };
      }
      if (
        result.reason === "not_found" ||
        result.reason === "revision_conflict"
      ) {
        return { ok: false, reason: result.reason };
      }
      throw new Error(`page service persistence: ${result.reason}`);
    }
    return {
      ok: true,
      outcome: result.outcome === "updated" ? "renamed" : "replaced_trial",
      page: await this.#materialize_aggregate(result.page),
    };
  }

  async #duplicate_managed_record(request: {
    source_page_id: string;
    owner_user_id: string;
    expected_revision: number;
    page_id: string;
    endpoint_set: PageEndpointSet;
    now: Date;
  }): Promise<
    MaterializedPageMutationResult<
      "created" | "replaced_trial",
      | "not_found"
      | "revision_conflict"
      | "locator_conflict"
      | "page_id_conflict"
      | "endpoint_capacity_exceeded"
    >
  > {
    const result = await this.#repository.duplicate_managed_page_aggregate({
      source_page_id: request.source_page_id,
      owner_user_id: request.owner_user_id,
      expected_revision: request.expected_revision,
      page_id: request.page_id,
      endpoint_set: request.endpoint_set,
      now: request.now,
    });
    if (!result.ok) {
      if (result.reason === "endpoint_conflict") {
        return { ok: false, reason: "locator_conflict" };
      }
      return { ok: false, reason: result.reason };
    }
    return {
      ok: true,
      outcome: result.outcome,
      page: await this.#materialize_aggregate(result.page),
    };
  }

  async #find_public_record_by_locator(
    locator: Locator,
  ): Promise<MaterializedPage | null> {
    const resolved = await this.#repository.resolve_page_endpoint(locator);
    if (
      resolved === null || resolved.page.access !== "public" ||
      page_aggregate_violation(resolved.page) !== null
    ) {
      return null;
    }
    const asset = await this.#repository.find_content_asset_by_id(
      resolved.page.content_asset_id,
    );
    return asset === null
      ? null
      : this.#materialize_aggregate_with_asset(resolved.page, asset);
  }

  async #resolve_delivery_record(
    locator: Locator,
    actor: { kind: "guest" } | UserPageActor,
  ): Promise<
    | {
      readonly ok: true;
      readonly page: MaterializedPage;
      readonly endpoint: PageEndpointBinding;
    }
    | { readonly ok: false; readonly reason: "not_found" | "corrupt" }
  > {
    const resolved = await this.#repository.resolve_page_endpoint(locator);
    if (resolved === null) return { ok: false, reason: "not_found" };
    const violation = page_aggregate_violation(resolved.page);
    if (violation !== null) {
      return resolved.page.access === "private"
        ? { ok: false, reason: "not_found" }
        : { ok: false, reason: "corrupt" };
    }
    if (!can_deliver_page_to(resolved.page, actor)) {
      return { ok: false, reason: "not_found" };
    }
    const asset = await this.#repository.find_content_asset_by_id(
      resolved.page.content_asset_id,
    );
    if (asset === null) {
      return resolved.page.access === "private"
        ? { ok: false, reason: "not_found" }
        : { ok: false, reason: "corrupt" };
    }
    return {
      ok: true,
      page: this.#materialize_aggregate_with_asset(resolved.page, asset),
      endpoint: resolved.endpoint,
    };
  }

  async #stage_content_asset(
    content: PageContent,
    created_at: Date,
  ): Promise<ContentAssetId> {
    for (let attempt = 0; attempt < this.#max_page_id_attempts; attempt += 1) {
      const content_asset_id = this.#content_asset_id_generator.generate();
      if (!is_valid_content_asset_id(content_asset_id)) {
        throw new Error(
          "ContentAssetIdGenerator produced an invalid content asset id",
        );
      }
      const asset: ContentAsset = {
        content_asset_id,
        content_type: content.content_type,
        data: content.data,
        meta: content.meta,
        created_at,
      };
      const result = await this.#repository.create_content_asset(asset);
      if (result.ok) return result.asset.content_asset_id;
    }
    throw new Error("content asset id generation exhausted");
  }

  async #materialize_aggregate(
    page: PageAggregate,
  ): Promise<MaterializedPage> {
    const asset = await this.#repository.find_content_asset_by_id(
      page.content_asset_id,
    );
    if (asset === null) {
      throw new Error("page aggregate references a missing content asset");
    }
    return this.#materialize_aggregate_with_asset(page, asset);
  }

  #materialize_aggregate_with_asset(
    page: PageAggregate,
    asset: ContentAsset,
  ): MaterializedPage {
    return {
      ...structuredClone(page),
      content: {
        content_type: asset.content_type,
        data: structuredClone(asset.data),
        meta: structuredClone(asset.meta),
      },
    };
  }

  async #endpoint_authorities(
    actor: { kind: "guest" } | UserPageActor,
    endpoint_set: PageEndpointSet,
  ): Promise<Array<"unreserved" | "owned" | "reserved_by_other">> {
    const namespaces = new Map<string, string>();
    for (
      const endpoint of [
        endpoint_set.canonical,
        ...endpoint_set.alternates,
      ]
    ) {
      const key = endpoint.locator.namespace.toLowerCase();
      if (!namespaces.has(key)) namespaces.set(key, endpoint.locator.namespace);
    }
    return await Promise.all(
      [...namespaces.values()].map(async (namespace) =>
        (await this.#namespace_authority.resolve(actor, namespace)).kind
      ),
    );
  }

  async #managed_endpoint_authority_failure(
    actor: UserPageActor,
    endpoint_set: PageEndpointSet,
  ): Promise<"namespace_not_reserved" | "namespace_reserved" | null> {
    const authorities = await this.#endpoint_authorities(actor, endpoint_set);
    if (authorities.includes("reserved_by_other")) {
      return "namespace_reserved";
    }
    return authorities.includes("unreserved") ? "namespace_not_reserved" : null;
  }

  #prepare_endpoint_command(
    command: {
      readonly locator?: Locator;
      readonly endpoint_set?: PageEndpointSetIntent;
    },
    content_type: string,
  ): EndpointPreparationResult {
    if (
      (command.locator === undefined) === (command.endpoint_set === undefined)
    ) {
      return { ok: false, reason: "invalid_locator" };
    }
    return this.#prepare_endpoint_intent(
      command.endpoint_set ?? {
        canonical: {
          locator: command.locator!,
          delivery_profile: "inline",
        },
      },
      content_type,
    );
  }

  #prepare_endpoint_intent(
    endpoint_set: PageEndpointSetIntent,
    content_type: string,
  ): EndpointPreparationResult {
    const handler = this.#handlers.get(content_type);
    if (handler === undefined) {
      return { ok: false, reason: "unknown_content_type" };
    }
    const planned = this.#endpoint_planner.plan({
      endpoint_set,
      supported_delivery_profiles: handler.supported_delivery_profiles,
    });
    if (!planned.ok) return planned;
    if (!this.#repository.can_persist_page_endpoint_set(planned.endpoint_set)) {
      return { ok: false, reason: "endpoint_capacity_exceeded" };
    }
    return planned;
  }

  #canonical_inline_endpoint_set(
    locator: Locator,
    content_type: string,
  ): PageEndpointSet {
    const handler = this.#handlers.get(content_type);
    if (handler === undefined) {
      throw new Error(
        `unknown content type during endpoint planning: ${content_type}`,
      );
    }
    const planned = this.#endpoint_planner.plan({
      endpoint_set: {
        canonical: { locator, delivery_profile: "inline" },
      },
      supported_delivery_profiles: handler.supported_delivery_profiles,
    });
    if (!planned.ok) {
      throw new Error(
        `canonical inline endpoint planning failed: ${planned.reason}`,
      );
    }
    return planned.endpoint_set;
  }

  #prepare_content(command: PageContentCommand): ContentPreparationResult {
    const handler = this.#handlers.get(command.content_type);
    if (handler === undefined) {
      return { ok: false, reason: "unknown_content_type" };
    }
    const validated = handler.validate(command.input);
    if (!validated.ok) {
      return { ok: false, reason: "invalid_input", detail: validated.reason };
    }
    const data = handler.derive(validated.value);
    const meta = meta_from_payload(handler.render(data));
    return {
      ok: true,
      content: { content_type: handler.content_type, data, meta },
    };
  }

  async #find_authorized_page(
    actor: UserPageActor,
    page_id: string,
  ): Promise<MaterializedPage | null> {
    if (!is_valid_page_id(page_id)) return null;
    const aggregate = await this.#repository.find_page_aggregate_by_id(page_id);
    if (
      aggregate === null || aggregate.stewardship.kind !== "managed" ||
      aggregate.stewardship.owner_user_id !== actor.user_id
    ) {
      return null;
    }
    const authority = await this.#namespace_authority.resolve(
      actor,
      aggregate.endpoint_set.canonical.locator.namespace,
    );
    return authority.kind === "owned"
      ? await this.#materialize_aggregate(aggregate)
      : null;
  }

  #inspection(page: MaterializedPage): ManagedPageInspection {
    const handler = this.#require_handler(page.content.content_type);
    return {
      ...this.#summary(page),
      content: {
        content_type: page.content.content_type,
        input: handler.to_management(page.content.data),
      },
    };
  }

  #require_handler(
    content_type: string,
  ): ContentTypeHandler<unknown, unknown> {
    const handler = this.#handlers.get(content_type);
    if (handler === undefined) {
      throw new Error(
        `stored page content type has no handler: ${content_type}`,
      );
    }
    return handler;
  }

  #public_summary(page: MaterializedPage): PublicPageSummary {
    const locator = page.endpoint_set.canonical.locator;
    return {
      locator: structuredClone(locator),
      path: this.#engine.format(locator),
      endpoints: this.#endpoint_links(page),
      stewardship: page.stewardship.kind,
      content_type: page.content.content_type,
      media_type: page.content.meta.media_type,
      size_bytes: page.content.meta.size_bytes,
      tags: [...page.tags],
      created_at: new Date(page.created_at),
      updated_at: new Date(page.updated_at),
    };
  }

  #summary(page: MaterializedPage): PageSummary {
    const locator = page.endpoint_set.canonical.locator;
    return {
      page_id: page.page_id,
      locator: structuredClone(locator),
      path: this.#engine.format(locator),
      endpoints: this.#endpoint_links(page),
      access: page.access,
      content_type: page.content.content_type,
      size_bytes: page.content.meta.size_bytes,
      tags: [...page.tags],
      created_at: new Date(page.created_at),
      updated_at: new Date(page.updated_at),
      revision: page.revision,
    };
  }

  #endpoint_set(page: MaterializedPage): PageEndpointSet {
    return structuredClone(page.endpoint_set);
  }

  #endpoint_links(page: MaterializedPage) {
    return project_page_endpoint_links(this.#endpoint_set(page), this.#engine);
  }

  #generate_page_id(): string {
    const page_id = this.#page_id_generator.generate();
    if (!is_valid_page_id(page_id)) {
      throw new Error("PageIdGenerator produced an invalid page id");
    }
    return page_id;
  }

  #operation_time(): Date {
    const now = this.#clock.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error("PageClock produced an invalid date");
    }
    return new Date(now);
  }

  #require_guest(actor: { kind: "guest" }): void {
    if (actor.kind !== "guest") throw new Error("trial actor must be a guest");
  }

  #require_user(actor: UserPageActor): void {
    if (actor.kind !== "user" || actor.user_id === "") {
      throw new Error("managed actor must be an authenticated user");
    }
  }
}

function page_endpoint_sets_equal(
  left: PageEndpointSet,
  right: PageEndpointSet,
): boolean {
  const left_bindings = [left.canonical, ...left.alternates];
  const right_bindings = [right.canonical, ...right.alternates];
  return left_bindings.length === right_bindings.length &&
    left_bindings.every((binding, index) =>
      page_endpoint_bindings_equal(binding, right_bindings[index])
    );
}

function page_endpoint_bindings_equal(
  left: PageEndpointBinding,
  right: PageEndpointBinding,
): boolean {
  return left.delivery_profile === right.delivery_profile &&
    left.locator.namespace === right.locator.namespace &&
    left.locator.page_name === right.locator.page_name;
}

function can_deliver_page_to(
  page: Pick<PageAggregate, "access" | "stewardship">,
  actor: { kind: "guest" } | UserPageActor,
): boolean {
  return page.access !== "private" ||
    (page.stewardship.kind === "managed" && actor.kind === "user" &&
      actor.user_id === page.stewardship.owner_user_id);
}

function is_valid_bulk_selection(
  value: unknown,
): value is readonly ManagedPageRevisionSelection[] {
  if (
    !Array.isArray(value) || value.length < 1 ||
    value.length > max_bulk_managed_pages
  ) {
    return false;
  }
  const page_ids = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null) return false;
    const selected = candidate as Record<string, unknown>;
    if (
      typeof selected.page_id !== "string" ||
      !is_valid_page_id(selected.page_id) ||
      !is_valid_page_revision(selected.expected_revision) ||
      page_ids.has(selected.page_id)
    ) {
      return false;
    }
    page_ids.add(selected.page_id);
  }
  return true;
}

function normalize_optional_query(
  value: string | undefined,
  max_length: number,
): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return undefined;
  return normalized.length > max_length ? null : normalized;
}

function normalize_exploration_query(
  value: string | undefined,
): string | undefined | null {
  return normalize_optional_query(value, max_public_exploration_query_length);
}

function normalize_tag_filter(
  value: string | undefined,
): string | undefined | null {
  if (value === undefined || value.trim() === "") return undefined;
  return normalize_page_tag(value);
}

/** Delivery metadata derived from the deterministic rendered representation. */
function meta_from_payload(payload: DeliveryPayload): ContentMeta {
  const size_bytes = typeof payload.body === "string"
    ? new TextEncoder().encode(payload.body).byteLength
    : payload.body.byteLength;
  return payload.download_filename === undefined
    ? { media_type: payload.media_type, size_bytes }
    : {
      media_type: payload.media_type,
      size_bytes,
      download_filename: payload.download_filename,
    };
}
