import type { ContentTypeHandler } from "../content/interfaces.ts";
import type { ContentMeta, DeliveryPayload } from "../content/model.ts";
import type { LocatorEngine } from "../locator/engine.ts";
import type { Locator } from "../locator/model.ts";
import {
  FourWordRandomNameGenerator,
  type RandomNameGenerator,
} from "../random-name.ts";
import {
  max_managed_page_name_query_length,
  max_public_exploration_query_length,
} from "./interfaces.ts";
import type {
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
  ManagedPageCreator,
  ManagedPageDeleter,
  ManagedPageDuplicator,
  ManagedPageInspection,
  ManagedPageInspector,
  ManagedPageLister,
  ManagedPageRenamer,
  ManagedPageUpdater,
  NamespaceAuthorityResolver,
  PageClock,
  PageContentCommand,
  PageDeliverer,
  PageIdGenerator,
  PageRepository,
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
  page_record_violation,
  type PageContent,
  type PageRecord,
} from "./model.ts";
import { CryptoPageIdGenerator, SystemPageClock } from "./generators.ts";

export interface PageServiceOptions {
  engine: LocatorEngine;
  repository: PageRepository;
  namespace_authority: NamespaceAuthorityResolver;
  handlers: readonly ContentTypeHandler<unknown, unknown>[];
  page_id_generator?: PageIdGenerator;
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

/**
 * HTTP/session-independent page application layer (DS-PROTECT, DS-MANAGE). It
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
    ManagedPageRenamer,
    ManagedPageDuplicator,
    PublicPageViewer,
    PublicPageLister,
    PublicPageExplorer,
    PageDeliverer {
  readonly #engine: LocatorEngine;
  readonly #repository: PageRepository;
  readonly #namespace_authority: NamespaceAuthorityResolver;
  readonly #handlers = new Map<
    string,
    ContentTypeHandler<unknown, unknown>
  >();
  readonly #page_id_generator: PageIdGenerator;
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
    const locator_error = this.#locator_error(request.locator);
    if (locator_error !== null) return locator_error;
    if (!is_valid_page_access(request.access)) {
      return { ok: false, reason: "invalid_access" };
    }
    if (request.access === "private") {
      return { ok: false, reason: "private_requires_managed_page" };
    }
    const authority = await this.#namespace_authority.resolve(
      request.actor,
      request.locator.namespace,
    );
    if (authority.kind !== "unreserved") {
      return { ok: false, reason: "namespace_reserved" };
    }
    const prepared = this.#prepare_content(request.content);
    if (!prepared.ok) return prepared;
    const now = this.#operation_time();
    for (let attempt = 0; attempt < this.#max_page_id_attempts; attempt++) {
      const page_id = this.#generate_page_id();
      const result = await this.#repository.put_trial({
        page_id,
        locator: request.locator,
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
    }
    return { ok: false, reason: "page_id_generation_exhausted" };
  }

  async create_managed(
    request: CreateManagedPageRequest,
  ): Promise<CreateManagedPageResult> {
    this.#require_user(request.actor);
    const locator_error = this.#locator_error(request.locator);
    if (locator_error !== null) return locator_error;
    if (!is_valid_page_access(request.access)) {
      return { ok: false, reason: "invalid_access" };
    }
    const tags = normalize_page_tags(request.tags ?? []);
    if (tags === null) return { ok: false, reason: "invalid_tags" };
    const authority = await this.#namespace_authority.resolve(
      request.actor,
      request.locator.namespace,
    );
    if (authority.kind === "unreserved") {
      return { ok: false, reason: "namespace_not_reserved" };
    }
    if (authority.kind === "reserved_by_other") {
      return { ok: false, reason: "namespace_reserved" };
    }
    const prepared = this.#prepare_content(request.content);
    if (!prepared.ok) return prepared;
    const now = this.#operation_time();
    for (let attempt = 0; attempt < this.#max_page_id_attempts; attempt++) {
      const page_id = this.#generate_page_id();
      const result = await this.#repository.create_managed({
        page_id,
        locator: request.locator,
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
    const listed = await this.#repository.list_managed({
      owner_user_id: request.actor.user_id,
      ...(namespace === undefined ? {} : { namespace }),
      ...(page_name_query === undefined ? {} : { page_name_query }),
      ...(request.access === undefined ? {} : { access: request.access }),
      ...(tag === undefined ? {} : { tag }),
      limit: request.limit,
      cursor: request.cursor,
    });
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
    return this.#inspection(page);
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
    if (!has_access && !has_tags && !has_content) {
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
    // The successful response is an inspection representation. Refuse before
    // mutation when retained content has no handler, rather than committing an
    // access-only change and only then discovering that source cannot render.
    if (!this.#handlers.has(page.content.content_type)) {
      return { ok: false, reason: "unknown_content_type" };
    }
    let content: PageContent | undefined;
    if (request.patch.content !== undefined) {
      const prepared = this.#prepare_content(request.patch.content);
      if (!prepared.ok) return prepared;
      content = prepared.content;
    }
    const replaced = await this.#repository.replace_managed({
      page_id: page.page_id,
      owner_user_id: request.actor.user_id,
      expected_revision: request.expected_revision,
      access: request.patch.access ?? page.access,
      tags,
      content,
      now: this.#operation_time(),
    });
    if (!replaced.ok) return replaced;
    return this.#inspection(replaced.page);
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
    if (!current_inspection.ok) return current_inspection;
    const locator: Locator = request.page_name === undefined
      ? { namespace: existing.locator.namespace }
      : { namespace: existing.locator.namespace, page_name: request.page_name };
    if (!this.#engine.validate(locator).ok) {
      return { ok: false, reason: "invalid_page_name" };
    }
    if (existing.locator.page_name === locator.page_name) {
      return {
        ok: true,
        outcome: "unchanged",
        page: current_inspection.page,
      };
    }
    if (existing.revision === Number.MAX_SAFE_INTEGER) {
      return { ok: false, reason: "revision_exhausted" };
    }
    const renamed = await this.#repository.rename_managed({
      page_id: existing.page_id,
      owner_user_id: request.actor.user_id,
      expected_revision: request.expected_revision,
      locator,
      now: this.#operation_time(),
    });
    if (!renamed.ok) {
      if (renamed.reason === "locator_conflict") {
        return { ok: false, reason: "page_exists" };
      }
      return { ok: false, reason: renamed.reason };
    }
    const inspection = this.#inspection(renamed.page);
    return inspection.ok
      ? { ok: true, outcome: renamed.outcome, page: inspection.page }
      : inspection;
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
    const source_inspection = this.#inspection(source);
    if (!source_inspection.ok) return source_inspection;

    const now = this.#operation_time();
    const used_names = new Set<string>();
    if (source.locator.page_name !== undefined) {
      used_names.add(source.locator.page_name.toLowerCase());
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
      const locator = { namespace: source.locator.namespace, page_name };
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
        const duplicated = await this.#repository.duplicate_managed({
          source_page_id: source.page_id,
          owner_user_id: request.actor.user_id,
          expected_revision: request.expected_revision,
          page_id,
          locator,
          now,
        });
        if (duplicated.ok) {
          const inspection = this.#inspection(duplicated.page);
          return inspection.ok
            ? {
              ok: true,
              outcome: duplicated.outcome,
              page: inspection.page,
            }
            : inspection;
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
    return await this.#repository.delete_managed({
      page_id: page.page_id,
      owner_user_id: request.actor.user_id,
      expected_revision: request.expected_revision,
    });
  }

  async view_public(locator: Locator): Promise<ViewPublicPageResult> {
    if (!this.#engine.validate(locator).ok) {
      return { ok: false, reason: "not_found" };
    }
    const page = await this.#repository.find_by_locator(locator);
    if (
      page === null || page.access !== "public" ||
      page_record_violation(page) !== null
    ) {
      // Missing, private, and incoherent pages are indistinguishable to
      // visitors (OQ-ACCESS, OQ-MISSING).
      return { ok: false, reason: "not_found" };
    }
    const handler = this.#handlers.get(page.content.content_type);
    return {
      ok: true,
      page: this.#public_summary(page),
      payload: handler === undefined ? null : handler.render(page.content.data),
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
    const listed = await this.#repository.list_public({
      namespace: validation.locator.namespace,
      limit: request.limit,
      cursor: request.cursor,
    });
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
    const explored = await this.#repository.explore_public({
      ...(namespace_query === undefined ? {} : { namespace_query }),
      ...(page_name_query === undefined ? {} : { page_name_query }),
      ...(tag === undefined ? {} : { tag }),
      limit: request.limit,
      cursor: request.cursor,
    });
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
    const page = await this.#repository.find_by_locator(locator);
    if (page === null) {
      return { ok: false as const, reason: "not_found" as const };
    }
    const violation = page_record_violation(page);
    if (violation !== null) {
      if (page.access === "private") {
        return { ok: false as const, reason: "not_found" as const };
      }
      return { ok: false as const, reason: "corrupt" as const };
    }
    if (page.access === "private") {
      if (
        page.stewardship.kind !== "managed" || actor.kind !== "user" ||
        actor.user_id !== page.stewardship.owner_user_id
      ) {
        return { ok: false as const, reason: "not_found" as const };
      }
    }
    const handler = this.#handlers.get(page.content.content_type);
    if (handler === undefined) {
      return { ok: false as const, reason: "unknown_content_type" as const };
    }
    return {
      ok: true as const,
      page,
      payload: handler.render(page.content.data),
    };
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
  ): Promise<PageRecord | null> {
    if (!is_valid_page_id(page_id)) return null;
    const page = await this.#repository.find_by_id(page_id);
    if (
      page === null || page.stewardship.kind !== "managed" ||
      page.stewardship.owner_user_id !== actor.user_id
    ) {
      return null;
    }
    const authority = await this.#namespace_authority.resolve(
      actor,
      page.locator.namespace,
    );
    return authority.kind === "owned" ? page : null;
  }

  #inspection(page: PageRecord): InspectManagedPageResult {
    const handler = this.#handlers.get(page.content.content_type);
    if (handler === undefined) {
      return { ok: false, reason: "unknown_content_type" };
    }
    const inspection: ManagedPageInspection = {
      ...this.#summary(page),
      content: {
        content_type: page.content.content_type,
        input: handler.to_input(page.content.data),
      },
    };
    return { ok: true, page: inspection };
  }

  #public_summary(page: PageRecord): PublicPageSummary {
    return {
      locator: structuredClone(page.locator),
      path: this.#engine.format(page.locator),
      stewardship: page.stewardship.kind,
      content_type: page.content.content_type,
      media_type: page.content.meta.media_type,
      size_bytes: page.content.meta.size_bytes,
      tags: [...page.tags],
      created_at: new Date(page.created_at),
      updated_at: new Date(page.updated_at),
    };
  }

  #summary(page: PageRecord): PageSummary {
    return {
      page_id: page.page_id,
      locator: structuredClone(page.locator),
      path: this.#engine.format(page.locator),
      access: page.access,
      content_type: page.content.content_type,
      size_bytes: page.content.meta.size_bytes,
      tags: [...page.tags],
      created_at: new Date(page.created_at),
      updated_at: new Date(page.updated_at),
      revision: page.revision,
    };
  }

  #locator_error(locator: Locator):
    | { ok: false; reason: "forbidden_namespace" | "invalid_locator" }
    | null {
    const validation = this.#engine.validate(locator);
    if (validation.ok) return null;
    return {
      ok: false,
      reason: validation.reason === "forbidden_namespace"
        ? "forbidden_namespace"
        : "invalid_locator",
    };
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
