import type { ContentAsset } from "../content/asset.ts";
import { is_valid_content_asset_id } from "../content/asset.ts";
import { CryptoContentAssetIdGenerator } from "../content/generators.ts";
import type { ContentAssetIdGenerator } from "../content/interfaces.ts";
import type { Locator } from "../locator/model.ts";
import type { PageAggregate } from "./aggregate.ts";
import type { PageEndpointSet } from "./endpoint.ts";
import type {
  CreateManagedRequest,
  CreateManagedResult,
  DeleteManagedRequest,
  DeleteManagedResult,
  DuplicateManagedRequest,
  DuplicateManagedResult,
  ExplorePublicRequest,
  ExplorePublicResult,
  ListManagedRequest,
  ListManagedResult,
  ListPublicRequest,
  ListPublicResult,
  PageRepository,
  PutTrialRequest,
  PutTrialResult,
  RenameManagedRequest,
  RenameManagedResult,
  ReplaceManagedRequest,
  ReplaceManagedResult,
} from "./interfaces.ts";
import { MemoryPageAggregateRepository } from "./memory-aggregate-repository.ts";
import type { PageContent, PageRecord } from "./model.ts";

const max_asset_id_attempts = 16;

/**
 * Compatibility projection of the split memory persistence through the legacy
 * one-locator `PageRepository` contract. New application code uses the focused
 * inherited asset/aggregate capabilities; retained repository conformance and
 * legacy composition can still exercise the old shape during migration.
 */
export class MemoryPageRepository extends MemoryPageAggregateRepository
  implements PageRepository {
  readonly #content_asset_id_generator: ContentAssetIdGenerator;

  constructor(options: {
    content_asset_id_generator?: ContentAssetIdGenerator;
  } = {}) {
    super();
    this.#content_asset_id_generator = options.content_asset_id_generator ??
      new CryptoContentAssetIdGenerator();
  }

  async find_by_locator(locator: Locator): Promise<PageRecord | null> {
    const resolved = await this.resolve_page_endpoint(locator);
    return resolved === null ? null : await this.#materialize(resolved.page);
  }

  async find_by_id(page_id: string): Promise<PageRecord | null> {
    const page = await this.find_page_aggregate_by_id(page_id);
    return page === null ? null : await this.#materialize(page);
  }

  async list_managed(request: ListManagedRequest): Promise<ListManagedResult> {
    const listed = await this.list_managed_page_aggregates(request);
    if (!listed.ok) return listed;
    return {
      ok: true,
      pages: await Promise.all(
        listed.pages.map((page) => this.#materialize(page)),
      ),
      next_cursor: listed.next_cursor,
    };
  }

  async list_public(request: ListPublicRequest): Promise<ListPublicResult> {
    const listed = await this.list_public_page_aggregates(request);
    if (!listed.ok) return listed;
    return {
      ok: true,
      pages: await Promise.all(
        listed.pages.map((page) => this.#materialize(page)),
      ),
      next_cursor: listed.next_cursor,
    };
  }

  async explore_public(
    request: ExplorePublicRequest,
  ): Promise<ExplorePublicResult> {
    const explored = await this.explore_public_page_aggregates(request);
    if (!explored.ok) return explored;
    return {
      ok: true,
      pages: await Promise.all(
        explored.pages.map((page) => this.#materialize(page)),
      ),
      next_cursor: explored.next_cursor,
    };
  }

  async put_trial(request: PutTrialRequest): Promise<PutTrialResult> {
    const content_asset_id = await this.#stage_content(
      request.content,
      request.now,
    );
    const result = await this.put_trial_page_aggregate({
      page_id: request.page_id,
      endpoint_set: canonical_inline_endpoint(request.locator),
      content_asset_id,
      now: request.now,
    });
    if (!result.ok) {
      if (
        result.reason === "managed_conflict" ||
        result.reason === "page_id_conflict"
      ) {
        return { ok: false, reason: result.reason };
      }
      throw new Error(`page repository: ${result.reason}`);
    }
    return {
      ok: true,
      outcome: result.outcome,
      page: await this.#materialize(result.page),
    };
  }

  async create_managed(
    request: CreateManagedRequest,
  ): Promise<CreateManagedResult> {
    const content_asset_id = await this.#stage_content(
      request.content,
      request.now,
    );
    const result = await this.create_managed_page_aggregate({
      page_id: request.page_id,
      endpoint_set: canonical_inline_endpoint(request.locator),
      owner_user_id: request.owner_user_id,
      access: request.access,
      tags: request.tags,
      content_asset_id,
      now: request.now,
    });
    if (!result.ok) {
      if (
        result.reason === "managed_conflict" ||
        result.reason === "page_id_conflict"
      ) {
        return { ok: false, reason: result.reason };
      }
      throw new Error(`page repository: ${result.reason}`);
    }
    return {
      ok: true,
      outcome: result.outcome,
      page: await this.#materialize(result.page),
    };
  }

  async replace_managed(
    request: ReplaceManagedRequest,
  ): Promise<ReplaceManagedResult> {
    const content_asset_id = request.content === undefined
      ? undefined
      : await this.#stage_content(request.content, request.now);
    const result = await this.update_managed_page_aggregate({
      page_id: request.page_id,
      owner_user_id: request.owner_user_id,
      expected_revision: request.expected_revision,
      patch: {
        access: request.access,
        ...(request.tags === undefined ? {} : { tags: request.tags }),
        ...(content_asset_id === undefined ? {} : { content_asset_id }),
      },
      now: request.now,
    });
    if (!result.ok) {
      if (
        result.reason === "not_found" ||
        result.reason === "revision_conflict"
      ) {
        return { ok: false, reason: result.reason };
      }
      throw new Error(`page repository: ${result.reason}`);
    }
    return { ok: true, page: await this.#materialize(result.page) };
  }

  async rename_managed(
    request: RenameManagedRequest,
  ): Promise<RenameManagedResult> {
    const result = await this.update_managed_page_aggregate({
      page_id: request.page_id,
      owner_user_id: request.owner_user_id,
      expected_revision: request.expected_revision,
      patch: { endpoint_set: canonical_inline_endpoint(request.locator) },
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
      throw new Error(`page repository: ${result.reason}`);
    }
    return {
      ok: true,
      outcome: result.outcome === "updated" ? "renamed" : "replaced_trial",
      page: await this.#materialize(result.page),
    };
  }

  async duplicate_managed(
    request: DuplicateManagedRequest,
  ): Promise<DuplicateManagedResult> {
    const result = await this.duplicate_managed_page_aggregate({
      source_page_id: request.source_page_id,
      owner_user_id: request.owner_user_id,
      expected_revision: request.expected_revision,
      page_id: request.page_id,
      endpoint_set: canonical_inline_endpoint(request.locator),
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
      page: await this.#materialize(result.page),
    };
  }

  delete_managed(request: DeleteManagedRequest): Promise<DeleteManagedResult> {
    return this.delete_managed_page_aggregate(request);
  }

  async #stage_content(
    content: PageContent,
    created_at: Date,
  ): Promise<string> {
    for (let attempt = 0; attempt < max_asset_id_attempts; attempt += 1) {
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
      const created = await this.create_content_asset(asset);
      if (created.ok) return created.asset.content_asset_id;
    }
    throw new Error("page repository: content asset id generation exhausted");
  }

  async #materialize(page: PageAggregate): Promise<PageRecord> {
    const asset = await this.find_content_asset_by_id(page.content_asset_id);
    if (asset === null) {
      throw new Error("page repository invariant violated");
    }
    return {
      page_id: page.page_id,
      locator: structuredClone(page.endpoint_set.canonical.locator),
      stewardship: structuredClone(page.stewardship),
      access: page.access,
      tags: [...page.tags],
      revision: page.revision,
      content: {
        content_type: asset.content_type,
        data: structuredClone(asset.data),
        meta: structuredClone(asset.meta),
      },
      created_at: new Date(page.created_at),
      updated_at: new Date(page.updated_at),
    };
  }
}

function canonical_inline_endpoint(locator: Locator): PageEndpointSet {
  return {
    canonical: {
      locator: structuredClone(locator),
      delivery_profile: "inline",
    },
    alternates: [],
  };
}
