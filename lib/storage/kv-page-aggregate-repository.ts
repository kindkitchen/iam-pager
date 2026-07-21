import {
  type ContentAsset,
  type ContentAssetId,
  is_valid_content_asset_id,
} from "../content/asset.ts";
import type { CreateContentAssetResult } from "../content/interfaces.ts";
import type { Locator } from "../locator/model.ts";
import {
  page_aggregate_endpoint_bindings,
  page_aggregate_violation,
  type PageAggregate,
  type ResolvedPageEndpoint,
} from "../page/aggregate.ts";
import {
  aggregate_sort_key,
  matches_exploration,
  matches_managed_list,
  require_normalized_exploration_request,
  require_normalized_managed_list_request,
  require_positive_limit,
} from "../page/aggregate-query.ts";
import type {
  CreateManagedPageAggregateRequest,
  CreateManagedPageAggregateResult,
  DeleteManagedPageAggregateRequest,
  DeleteManagedPageAggregateResult,
  DuplicateManagedPageAggregateRequest,
  DuplicateManagedPageAggregateResult,
  ExplorePublicPageAggregatesRequest,
  ExplorePublicPageAggregatesResult,
  ListManagedPageAggregatesRequest,
  ListManagedPageAggregatesResult,
  ListPublicPageAggregatesRequest,
  ListPublicPageAggregatesResult,
  PageAggregateRepository,
  PutTrialPageAggregateRequest,
  PutTrialPageAggregateResult,
  UpdateManagedPageAggregateRequest,
  UpdateManagedPageAggregateResult,
} from "../page/aggregate-interfaces.ts";
import {
  compare_page_sort_keys,
  decode_managed_page_list_cursor,
  decode_page_exploration_cursor,
  decode_page_list_cursor,
  encode_managed_page_list_cursor,
  encode_page_exploration_cursor,
  encode_page_list_cursor,
  type ManagedPageListCursorScope,
  type PageExplorationCursorScope,
  type PageSortKey,
} from "../page/cursor.ts";
import {
  page_endpoint_set_violation,
  type PageEndpointSet,
} from "../page/endpoint.ts";
import {
  is_valid_page_access,
  is_valid_page_id,
  is_valid_page_revision,
  is_valid_page_tags,
  type PageId,
} from "../page/model.ts";
import type { KvGateway } from "./kv-gateway.ts";
import { is_exact_record, is_valid_stored_date } from "./record.ts";
import {
  KvContentAssetRepository,
  type KvContentAssetRepositoryOptions,
} from "./kv-content-asset-repository.ts";

export const page_aggregate_max_attempts = 16;
/** Proven worst case with eight source endpoints and eight eight-endpoint trials. */
export const max_page_aggregate_atomic_checks = 87;
/** Deno KV currently accepts at most 100 checks in one atomic operation. */
export const page_aggregate_atomic_check_headroom = 100 -
  max_page_aggregate_atomic_checks;

export const page_aggregate_storage_prefix: Deno.KvKey = [
  "iam-pager",
  "page-aggregates",
];
export const page_aggregate_by_id_prefix: Deno.KvKey = [
  ...page_aggregate_storage_prefix,
  "by-id",
];
export const page_endpoint_claim_prefix: Deno.KvKey = [
  ...page_aggregate_storage_prefix,
  "by-endpoint",
];
export const page_aggregate_owner_prefix: Deno.KvKey = [
  ...page_aggregate_storage_prefix,
  "by-owner",
];
export const page_aggregate_public_prefix: Deno.KvKey = [
  ...page_aggregate_storage_prefix,
  "public",
];

/** Authoritative page record. Payload bytes live only behind the asset manifest. */
type StoredPageAggregateEnvelope = PageAggregate;

/** Revision-bearing endpoint, owner, and public projection value. */
export interface StoredPageAggregatePointer {
  readonly page_id: string;
  readonly revision: number;
}

interface StoredPageSnapshot {
  readonly entry: Deno.KvEntry<unknown>;
  readonly page: PageAggregate;
  readonly endpoint_entries: readonly Deno.KvEntry<unknown>[];
  readonly index_entries: readonly Deno.KvEntry<unknown>[];
}

interface ClaimedEndpointState {
  readonly target_entries: readonly Deno.KvEntryMaybe<unknown>[];
  readonly snapshots: ReadonlyMap<PageId, StoredPageSnapshot>;
}

function require(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`page aggregate repository: ${message}`);
}

function invalid_stored_page_aggregate(): never {
  throw new TypeError("invalid stored page aggregate");
}

function invariant_violation(): never {
  throw new Error("page aggregate repository invariant violated");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function key_part_equals(a: Deno.KvKeyPart, b: Deno.KvKeyPart): boolean {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  }
  return a === b;
}

function key_equals(a: Deno.KvKey, b: Deno.KvKey): boolean {
  return a.length === b.length &&
    a.every((part, index) => key_part_equals(part, b[index]));
}

function same_entry_version(
  left: Deno.KvEntryMaybe<unknown>,
  right: Deno.KvEntryMaybe<unknown>,
): boolean {
  return key_equals(left.key, right.key) &&
    left.versionstamp === right.versionstamp;
}

function serialize_envelope(page: PageAggregate): StoredPageAggregateEnvelope {
  const violation = page_aggregate_violation(page);
  require(violation === null, violation ?? "invalid page aggregate");
  return clone(page);
}

function deserialize_envelope(value: unknown): PageAggregate {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    !is_exact_record(value, [
      "page_id",
      "endpoint_set",
      "stewardship",
      "access",
      "tags",
      "revision",
      "content_asset_id",
      "created_at",
      "updated_at",
    ])
  ) {
    return invalid_stored_page_aggregate();
  }
  try {
    const page = clone(value) as unknown as PageAggregate;
    return page_aggregate_violation(page) === null
      ? page
      : invalid_stored_page_aggregate();
  } catch {
    return invalid_stored_page_aggregate();
  }
}

function page_pointer(page: PageAggregate): StoredPageAggregatePointer {
  return { page_id: page.page_id, revision: page.revision };
}

function deserialize_pointer(value: unknown): StoredPageAggregatePointer {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid_stored_page_aggregate();
  }
  const stored = value as Record<string, unknown>;
  if (
    !is_exact_record(stored, ["page_id", "revision"]) ||
    !is_valid_page_id(stored.page_id) ||
    !is_valid_page_revision(stored.revision)
  ) {
    return invalid_stored_page_aggregate();
  }
  return stored as unknown as StoredPageAggregatePointer;
}

function locator_sort_parts(locator: Locator): {
  namespace_key: string;
  default_rank: 0 | 1;
  page_name_key: string;
} {
  return {
    namespace_key: locator.namespace.toLowerCase(),
    default_rank: locator.page_name === undefined ? 0 : 1,
    page_name_key: locator.page_name?.toLowerCase() ?? "",
  };
}

export function page_aggregate_storage_key(page_id: PageId): Deno.KvKey {
  return [...page_aggregate_by_id_prefix, page_id];
}

export function page_endpoint_claim_key(locator: Locator): Deno.KvKey {
  const normalized = locator_sort_parts(locator);
  return [
    ...page_endpoint_claim_prefix,
    normalized.namespace_key,
    normalized.default_rank,
    normalized.page_name_key,
  ];
}

function owner_list_prefix(
  owner_user_id: string,
  namespace?: string,
): Deno.KvKey {
  return namespace === undefined
    ? [...page_aggregate_owner_prefix, owner_user_id]
    : [...page_aggregate_owner_prefix, owner_user_id, namespace.toLowerCase()];
}

export function page_aggregate_owner_key(
  owner_user_id: string,
  key: PageSortKey,
): Deno.KvKey {
  return [
    ...page_aggregate_owner_prefix,
    owner_user_id,
    key.namespace_key,
    key.default_rank,
    key.page_name_key,
    key.page_id,
  ];
}

export function page_aggregate_public_key(key: PageSortKey): Deno.KvKey {
  return [
    ...page_aggregate_public_prefix,
    key.namespace_key,
    key.default_rank,
    key.page_name_key,
    key.page_id,
  ];
}

function endpoint_keys(page: PageAggregate): Deno.KvKey[] {
  return page_aggregate_endpoint_bindings(page).map((binding) =>
    page_endpoint_claim_key(binding.locator)
  );
}

function projection_keys(page: PageAggregate): Deno.KvKey[] {
  if (page.stewardship.kind !== "managed") return [];
  const key = aggregate_sort_key(page);
  return [
    page_aggregate_owner_key(page.stewardship.owner_user_id, key),
    ...(page.access === "public" ? [page_aggregate_public_key(key)] : []),
  ];
}

function visibility_index_values(
  page: PageAggregate,
): { readonly key: Deno.KvKey; readonly value: StoredPageAggregatePointer }[] {
  const pointer = page_pointer(page);
  return [
    ...endpoint_keys(page).map((key) => ({ key, value: pointer })),
    ...projection_keys(page).map((key) => ({ key, value: pointer })),
  ];
}

/**
 * Manifest-backed durable aggregate repository. One native Deno KV commit owns
 * every page, endpoint claim, owner row, and public row visibility mutation.
 */
export class KvPageAggregateRepository implements PageAggregateRepository {
  readonly #kv: KvGateway;
  readonly #assets: KvContentAssetRepository;

  constructor(
    kv: KvGateway,
    content_asset_options: KvContentAssetRepositoryOptions = {},
  ) {
    this.#kv = kv;
    this.#assets = new KvContentAssetRepository(kv, content_asset_options);
  }

  create_content_asset(asset: ContentAsset): Promise<CreateContentAssetResult> {
    return this.#assets.create_content_asset(asset);
  }

  find_content_asset_by_id(
    content_asset_id: ContentAssetId,
  ): Promise<ContentAsset | null> {
    return this.#assets.find_content_asset_by_id(content_asset_id);
  }

  async find_page_aggregate_by_id(
    page_id: PageId,
  ): Promise<PageAggregate | null> {
    this.#require_page_id(page_id);
    const snapshot = await this.#read_snapshot(page_id);
    return snapshot === null ? null : clone(snapshot.page);
  }

  async resolve_page_endpoint(
    locator: Locator,
  ): Promise<ResolvedPageEndpoint | null> {
    this.#require_locator(locator);
    const stable_locator = clone(locator);
    const key = page_endpoint_claim_key(stable_locator);
    for (let attempt = 0; attempt < page_aggregate_max_attempts; attempt += 1) {
      const claim_entry = await this.#kv.get<unknown>(key);
      if (claim_entry.versionstamp === null) return null;
      const pointer = deserialize_pointer(claim_entry.value);
      const snapshot = await this.#read_snapshot(pointer.page_id);
      const current_claim = await this.#kv.get<unknown>(key);
      if (!same_entry_version(claim_entry, current_claim)) continue;
      if (snapshot === null) invariant_violation();
      const snapshot_claim = snapshot.endpoint_entries.find((entry) =>
        key_equals(entry.key, key)
      );
      if (
        snapshot_claim === undefined ||
        snapshot_claim.versionstamp !== claim_entry.versionstamp ||
        pointer.revision !== snapshot.page.revision
      ) {
        invariant_violation();
      }
      const endpoint = page_aggregate_endpoint_bindings(snapshot.page).find(
        (binding) => key_equals(page_endpoint_claim_key(binding.locator), key),
      );
      if (endpoint === undefined) invariant_violation();
      return clone({ page: snapshot.page, endpoint });
    }
    throw new Error(
      "page aggregate repository read contention exhausted retries",
    );
  }

  async list_managed_page_aggregates(
    request: ListManagedPageAggregatesRequest,
  ): Promise<ListManagedPageAggregatesResult> {
    this.#require_owner(request.owner_user_id);
    require_positive_limit(request.limit);
    require(
      request.namespace === undefined ||
        (typeof request.namespace === "string" && request.namespace !== ""),
      "namespace filter must be non-empty when present",
    );
    require_normalized_managed_list_request(request);
    const scope: ManagedPageListCursorScope = {
      namespace: request.namespace?.toLowerCase() ?? null,
      page_name_query: request.page_name_query ?? null,
      access: request.access ?? null,
      tag: request.tag ?? null,
    };
    let after: PageSortKey | null = null;
    if (request.cursor !== undefined) {
      after = decode_managed_page_list_cursor(request.cursor, scope);
      if (after === null) return { ok: false, reason: "invalid_cursor" };
    }
    const prefix = owner_list_prefix(
      request.owner_user_id,
      request.namespace,
    );
    const start = after === null
      ? undefined
      : page_aggregate_owner_key(request.owner_user_id, after);
    const pages: PageAggregate[] = [];
    let has_more = false;
    for await (
      const entry of this.#kv.list<unknown>(
        start === undefined ? { prefix } : { prefix, start },
      )
    ) {
      if (start !== undefined && key_equals(entry.key, start)) continue;
      const pointer = deserialize_pointer(entry.value);
      const snapshot = await this.#read_snapshot(pointer.page_id);
      if (
        snapshot === null ||
        snapshot.page.stewardship.kind !== "managed" ||
        snapshot.page.stewardship.owner_user_id !== request.owner_user_id ||
        snapshot.page.revision !== pointer.revision ||
        !key_equals(
          entry.key,
          page_aggregate_owner_key(
            request.owner_user_id,
            aggregate_sort_key(snapshot.page),
          ),
        )
      ) {
        if (await this.#entry_changed(entry)) continue;
        invariant_violation();
      }
      const key = aggregate_sort_key(snapshot.page);
      if (after !== null && compare_page_sort_keys(key, after) <= 0) {
        invariant_violation();
      }
      if (!matches_managed_list(snapshot.page, key, scope)) continue;
      if (pages.length === request.limit) {
        has_more = true;
        break;
      }
      pages.push(clone(snapshot.page));
    }
    return {
      ok: true,
      pages,
      next_cursor: has_more
        ? encode_managed_page_list_cursor(
          aggregate_sort_key(pages[pages.length - 1]),
          scope,
        )
        : null,
    };
  }

  async list_public_page_aggregates(
    request: ListPublicPageAggregatesRequest,
  ): Promise<ListPublicPageAggregatesResult> {
    require(
      typeof request.namespace === "string" && request.namespace !== "",
      "namespace must be non-empty",
    );
    require_positive_limit(request.limit);
    const namespace_key = request.namespace.toLowerCase();
    let after: PageSortKey | null = null;
    if (request.cursor !== undefined) {
      after = decode_page_list_cursor(request.cursor, namespace_key);
      if (after === null) return { ok: false, reason: "invalid_cursor" };
    }
    const prefix: Deno.KvKey = [
      ...page_aggregate_public_prefix,
      namespace_key,
    ];
    const start = after === null ? undefined : page_aggregate_public_key(after);
    return await this.#list_public_index({
      prefix,
      start,
      after,
      limit: request.limit,
      cursor: (last) => encode_page_list_cursor(last, namespace_key),
    });
  }

  async explore_public_page_aggregates(
    request: ExplorePublicPageAggregatesRequest,
  ): Promise<ExplorePublicPageAggregatesResult> {
    require_normalized_exploration_request(request);
    const scope: PageExplorationCursorScope = {
      namespace_query: request.namespace_query ?? null,
      page_name_query: request.page_name_query ?? null,
      tag: request.tag ?? null,
    };
    let after: PageSortKey | null = null;
    if (request.cursor !== undefined) {
      after = decode_page_exploration_cursor(request.cursor, scope);
      if (after === null) return { ok: false, reason: "invalid_cursor" };
    }
    const pages: PageAggregate[] = [];
    let has_more = false;
    const start = after === null ? undefined : page_aggregate_public_key(after);
    for await (
      const entry of this.#kv.list<unknown>(
        start === undefined
          ? { prefix: page_aggregate_public_prefix }
          : { prefix: page_aggregate_public_prefix, start },
      )
    ) {
      if (start !== undefined && key_equals(entry.key, start)) continue;
      const page = await this.#page_from_public_entry(entry);
      if (page === null) continue;
      const key = aggregate_sort_key(page);
      if (after !== null && compare_page_sort_keys(key, after) <= 0) {
        invariant_violation();
      }
      if (!matches_exploration(page, key, scope)) continue;
      if (pages.length === request.limit) {
        has_more = true;
        break;
      }
      pages.push(page);
    }
    return {
      ok: true,
      pages,
      next_cursor: has_more
        ? encode_page_exploration_cursor(
          aggregate_sort_key(pages[pages.length - 1]),
          scope,
        )
        : null,
    };
  }

  async put_trial_page_aggregate(
    request: PutTrialPageAggregateRequest,
  ): Promise<PutTrialPageAggregateResult> {
    this.#require_page_id(request.page_id);
    this.#require_endpoint_set(request.endpoint_set);
    this.#require_content_asset_id(request.content_asset_id);
    this.#require_time(request.now);
    const page_id = request.page_id;
    const endpoint_set = clone(request.endpoint_set);
    const content_asset_id = request.content_asset_id;
    const now = clone(request.now);

    for (let attempt = 0; attempt < page_aggregate_max_attempts; attempt += 1) {
      const claimed = await this.#read_claimed_endpoint_state(endpoint_set);
      const claimed_trials = [...claimed.snapshots.values()].filter(
        (snapshot) => snapshot.page.stewardship.kind === "trial",
      );
      if (
        [...claimed.snapshots.values()].some((snapshot) =>
          snapshot.page.stewardship.kind === "managed"
        )
      ) {
        return { ok: false, reason: "managed_conflict" };
      }
      if (claimed_trials.length > 1) {
        return { ok: false, reason: "endpoint_conflict" };
      }
      const asset_entry = await this.#assets.find_content_asset_manifest_entry(
        content_asset_id,
      );
      if (asset_entry === null) {
        return { ok: false, reason: "content_asset_not_found" };
      }

      const existing = claimed_trials[0] ?? null;
      let new_id_entry: Deno.KvEntryMaybe<unknown> | null = null;
      if (existing === null) {
        new_id_entry = await this.#kv.get<unknown>(
          page_aggregate_storage_key(page_id),
        );
        if (new_id_entry.versionstamp !== null) {
          return { ok: false, reason: "page_id_conflict" };
        }
      } else if (existing.page.revision === Number.MAX_SAFE_INTEGER) {
        return { ok: false, reason: "revision_exhausted" };
      }

      const page: PageAggregate = existing === null
        ? {
          page_id,
          endpoint_set,
          stewardship: { kind: "trial" },
          access: "public",
          tags: [],
          revision: 1,
          content_asset_id,
          created_at: clone(now),
          updated_at: clone(now),
        }
        : {
          page_id: existing.page.page_id,
          endpoint_set,
          stewardship: { kind: "trial" },
          access: "public",
          tags: [],
          revision: existing.page.revision + 1,
          content_asset_id,
          created_at: clone(existing.page.created_at),
          updated_at: clone(now),
        };
      const checks = this.#merge_checks([
        ...this.#claimed_check_entries(claimed),
        ...(new_id_entry === null ? [] : [new_id_entry]),
        asset_entry,
      ]);
      if (checks === null) continue;
      const committed = await this.#commit(
        checks,
        (atomic) =>
          this.#replace_visibility(
            atomic,
            page,
            existing === null ? [] : [existing],
          ),
      );
      if (!committed) continue;
      return {
        ok: true,
        outcome: existing === null ? "created" : "replaced",
        page: clone(page),
      };
    }
    return this.#write_contention_exhausted();
  }

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
    const page_id = request.page_id;
    const endpoint_set = clone(request.endpoint_set);
    const owner_user_id = request.owner_user_id;
    const access = request.access;
    const tags = [...(request.tags ?? [])];
    const content_asset_id = request.content_asset_id;
    const now = clone(request.now);

    for (let attempt = 0; attempt < page_aggregate_max_attempts; attempt += 1) {
      const claimed = await this.#read_claimed_endpoint_state(endpoint_set);
      if (
        [...claimed.snapshots.values()].some((snapshot) =>
          snapshot.page.stewardship.kind === "managed"
        )
      ) {
        return { ok: false, reason: "managed_conflict" };
      }
      const new_id_entry = await this.#kv.get<unknown>(
        page_aggregate_storage_key(page_id),
      );
      if (new_id_entry.versionstamp !== null) {
        return { ok: false, reason: "page_id_conflict" };
      }
      const asset_entry = await this.#assets.find_content_asset_manifest_entry(
        content_asset_id,
      );
      if (asset_entry === null) {
        return { ok: false, reason: "content_asset_not_found" };
      }
      const page: PageAggregate = {
        page_id,
        endpoint_set,
        stewardship: { kind: "managed", owner_user_id },
        access,
        tags,
        revision: 1,
        content_asset_id,
        created_at: clone(now),
        updated_at: clone(now),
      };
      const destination_entries = await this.#read_destination_projections(
        page,
        new_id_entry,
        null,
      );
      if (destination_entries === null) continue;
      const checks = this.#merge_checks([
        ...this.#claimed_check_entries(claimed),
        new_id_entry,
        asset_entry,
        ...destination_entries,
      ]);
      if (checks === null) continue;
      const claimed_trials = [...claimed.snapshots.values()];
      const committed = await this.#commit(
        checks,
        (atomic) => this.#replace_visibility(atomic, page, claimed_trials),
      );
      if (!committed) continue;
      return {
        ok: true,
        outcome: claimed_trials.length === 0 ? "created" : "replaced_trial",
        page: clone(page),
      };
    }
    return this.#write_contention_exhausted();
  }

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
    const page_id = request.page_id;
    const owner_user_id = request.owner_user_id;
    const expected_revision = request.expected_revision;
    const endpoint_patch = request.patch.endpoint_set === undefined
      ? undefined
      : clone(request.patch.endpoint_set);
    const content_asset_patch = request.patch.content_asset_id;
    const access_patch = request.patch.access;
    const tags_patch = request.patch.tags === undefined
      ? undefined
      : [...request.patch.tags];
    const now = clone(request.now);

    for (let attempt = 0; attempt < page_aggregate_max_attempts; attempt += 1) {
      const existing = await this.#read_snapshot(page_id);
      if (
        existing === null || existing.page.stewardship.kind !== "managed" ||
        existing.page.stewardship.owner_user_id !== owner_user_id
      ) {
        return { ok: false, reason: "not_found" };
      }
      if (endpoint_patch !== undefined) {
        require(
          endpoint_patch.canonical.locator.namespace.toLowerCase() ===
            existing.page.endpoint_set.canonical.locator.namespace
              .toLowerCase(),
          "endpoint replacement must stay within the current namespace",
        );
      }
      if (existing.page.revision !== expected_revision) {
        return { ok: false, reason: "revision_conflict" };
      }
      if (existing.page.revision === Number.MAX_SAFE_INTEGER) {
        return { ok: false, reason: "revision_exhausted" };
      }

      const content_asset_id = content_asset_patch ??
        existing.page.content_asset_id;
      const asset_entry = await this.#assets.find_content_asset_manifest_entry(
        content_asset_id,
      );
      if (asset_entry === null) {
        if (content_asset_patch !== undefined) {
          return { ok: false, reason: "content_asset_not_found" };
        }
        invariant_violation();
      }

      const endpoint_set = endpoint_patch ?? existing.page.endpoint_set;
      let claimed: ClaimedEndpointState | null = null;
      const claimed_trials: StoredPageSnapshot[] = [];
      if (endpoint_patch !== undefined) {
        claimed = await this.#read_claimed_endpoint_state(endpoint_set);
        for (const snapshot of claimed.snapshots.values()) {
          if (snapshot.page.page_id === existing.page.page_id) continue;
          if (snapshot.page.stewardship.kind === "managed") {
            return { ok: false, reason: "endpoint_conflict" };
          }
          claimed_trials.push(snapshot);
        }
      }

      const page: PageAggregate = {
        ...existing.page,
        endpoint_set: clone(endpoint_set),
        access: access_patch ?? existing.page.access,
        tags: tags_patch ?? clone(existing.page.tags),
        revision: existing.page.revision + 1,
        content_asset_id,
        updated_at: clone(now),
      };
      const destination_entries = await this.#read_destination_projections(
        page,
        existing.entry,
        existing,
      );
      if (destination_entries === null) continue;
      const checks = this.#merge_checks([
        ...existing.index_entries,
        existing.entry,
        asset_entry,
        ...(claimed === null ? [] : this.#claimed_check_entries(claimed)),
        ...destination_entries,
      ]);
      if (checks === null) continue;
      const committed = await this.#commit(
        checks,
        (atomic) =>
          this.#replace_visibility(
            atomic,
            page,
            [existing, ...claimed_trials],
          ),
      );
      if (!committed) continue;
      return {
        ok: true,
        outcome: claimed_trials.length === 0 ? "updated" : "replaced_trial",
        page: clone(page),
      };
    }
    return this.#write_contention_exhausted();
  }

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
    const source_page_id = request.source_page_id;
    const page_id = request.page_id;
    const owner_user_id = request.owner_user_id;
    const expected_revision = request.expected_revision;
    const endpoint_set = clone(request.endpoint_set);
    const now = clone(request.now);

    for (let attempt = 0; attempt < page_aggregate_max_attempts; attempt += 1) {
      const source = await this.#read_snapshot(source_page_id);
      if (
        source === null || source.page.stewardship.kind !== "managed" ||
        source.page.stewardship.owner_user_id !== owner_user_id
      ) {
        return { ok: false, reason: "not_found" };
      }
      require(
        endpoint_set.canonical.locator.namespace.toLowerCase() ===
          source.page.endpoint_set.canonical.locator.namespace.toLowerCase(),
        "duplicate endpoints must stay within the source namespace",
      );
      if (source.page.revision !== expected_revision) {
        return { ok: false, reason: "revision_conflict" };
      }
      const claimed = await this.#read_claimed_endpoint_state(endpoint_set);
      for (const snapshot of claimed.snapshots.values()) {
        if (snapshot.page.stewardship.kind === "managed") {
          return { ok: false, reason: "endpoint_conflict" };
        }
      }
      const new_id_entry = await this.#kv.get<unknown>(
        page_aggregate_storage_key(page_id),
      );
      if (new_id_entry.versionstamp !== null) {
        return { ok: false, reason: "page_id_conflict" };
      }
      const asset_entry = await this.#assets.find_content_asset_manifest_entry(
        source.page.content_asset_id,
      );
      if (asset_entry === null) invariant_violation();
      const page: PageAggregate = {
        page_id,
        endpoint_set,
        stewardship: clone(source.page.stewardship),
        access: source.page.access,
        tags: clone(source.page.tags),
        revision: 1,
        content_asset_id: source.page.content_asset_id,
        created_at: clone(now),
        updated_at: clone(now),
      };
      const destination_entries = await this.#read_destination_projections(
        page,
        new_id_entry,
        null,
      );
      if (destination_entries === null) continue;
      const checks = this.#merge_checks([
        source.entry,
        ...source.index_entries,
        ...this.#claimed_check_entries(claimed),
        new_id_entry,
        asset_entry,
        ...destination_entries,
      ]);
      if (checks === null) continue;
      const claimed_trials = [...claimed.snapshots.values()];
      const committed = await this.#commit(
        checks,
        (atomic) => this.#replace_visibility(atomic, page, claimed_trials),
      );
      if (!committed) continue;
      return {
        ok: true,
        outcome: claimed_trials.length === 0 ? "created" : "replaced_trial",
        page: clone(page),
      };
    }
    return this.#write_contention_exhausted();
  }

  async delete_managed_page_aggregate(
    request: DeleteManagedPageAggregateRequest,
  ): Promise<DeleteManagedPageAggregateResult> {
    this.#require_page_id(request.page_id);
    this.#require_owner(request.owner_user_id);
    require(
      is_valid_page_revision(request.expected_revision),
      "expected_revision must be a positive safe integer",
    );
    const page_id = request.page_id;
    const owner_user_id = request.owner_user_id;
    const expected_revision = request.expected_revision;

    for (let attempt = 0; attempt < page_aggregate_max_attempts; attempt += 1) {
      const existing = await this.#read_snapshot(page_id);
      if (
        existing === null || existing.page.stewardship.kind !== "managed" ||
        existing.page.stewardship.owner_user_id !== owner_user_id
      ) {
        return { ok: false, reason: "not_found" };
      }
      if (existing.page.revision !== expected_revision) {
        return { ok: false, reason: "revision_conflict" };
      }
      const checks = this.#merge_checks([
        existing.entry,
        ...existing.index_entries,
      ]);
      if (checks === null) continue;
      const committed = await this.#commit(checks, (atomic) => {
        atomic.delete(existing.entry.key);
        for (const entry of existing.index_entries) atomic.delete(entry.key);
        return atomic;
      });
      if (committed) return { ok: true };
    }
    return this.#write_contention_exhausted();
  }

  async #list_public_index(options: {
    readonly prefix: Deno.KvKey;
    readonly start?: Deno.KvKey;
    readonly after: PageSortKey | null;
    readonly limit: number;
    readonly cursor: (last: PageSortKey) => string;
  }): Promise<ListPublicPageAggregatesResult> {
    const pages: PageAggregate[] = [];
    let has_more = false;
    for await (
      const entry of this.#kv.list<unknown>(
        options.start === undefined
          ? { prefix: options.prefix }
          : { prefix: options.prefix, start: options.start },
      )
    ) {
      if (
        options.start !== undefined && key_equals(entry.key, options.start)
      ) {
        continue;
      }
      const page = await this.#page_from_public_entry(entry);
      if (page === null) continue;
      const key = aggregate_sort_key(page);
      if (
        options.after !== null &&
        compare_page_sort_keys(key, options.after) <= 0
      ) {
        invariant_violation();
      }
      if (pages.length === options.limit) {
        has_more = true;
        break;
      }
      pages.push(page);
    }
    return {
      ok: true,
      pages,
      next_cursor: has_more
        ? options.cursor(aggregate_sort_key(pages[pages.length - 1]))
        : null,
    };
  }

  async #page_from_public_entry(
    entry: Deno.KvEntry<unknown>,
  ): Promise<PageAggregate | null> {
    const pointer = deserialize_pointer(entry.value);
    const snapshot = await this.#read_snapshot(pointer.page_id);
    if (
      snapshot === null || snapshot.page.stewardship.kind !== "managed" ||
      snapshot.page.access !== "public" ||
      snapshot.page.revision !== pointer.revision ||
      !key_equals(
        entry.key,
        page_aggregate_public_key(aggregate_sort_key(snapshot.page)),
      )
    ) {
      if (await this.#entry_changed(entry)) return null;
      invariant_violation();
    }
    return clone(snapshot.page);
  }

  async #read_snapshot(
    page_id: PageId,
  ): Promise<StoredPageSnapshot | null> {
    for (let attempt = 0; attempt < page_aggregate_max_attempts; attempt += 1) {
      const entry = await this.#kv.get<unknown>(
        page_aggregate_storage_key(page_id),
      );
      if (entry.versionstamp === null) return null;
      const page = deserialize_envelope(entry.value);
      if (
        page.page_id !== page_id ||
        !key_equals(entry.key, page_aggregate_storage_key(page.page_id))
      ) {
        invariant_violation();
      }
      const expected_endpoint_keys = endpoint_keys(page);
      const expected_projection_keys = projection_keys(page);
      const entries = await this.#get_entries([
        ...expected_endpoint_keys,
        ...expected_projection_keys,
      ]);
      const current = await this.#kv.get<unknown>(entry.key);
      if (!same_entry_version(entry, current)) continue;

      const endpoint_entries: Deno.KvEntry<unknown>[] = [];
      const index_entries: Deno.KvEntry<unknown>[] = [];
      for (
        const [index, expected_key] of [
          ...expected_endpoint_keys,
          ...expected_projection_keys,
        ].entries()
      ) {
        const index_entry = entries[index];
        if (
          index_entry.versionstamp === null ||
          !key_equals(index_entry.key, expected_key)
        ) {
          invariant_violation();
        }
        const pointer = deserialize_pointer(index_entry.value);
        if (
          pointer.page_id !== page.page_id ||
          pointer.revision !== page.revision
        ) {
          invariant_violation();
        }
        const present = index_entry as Deno.KvEntry<unknown>;
        index_entries.push(present);
        if (index < expected_endpoint_keys.length) {
          endpoint_entries.push(present);
        }
      }
      return {
        entry: entry as Deno.KvEntry<unknown>,
        page,
        endpoint_entries,
        index_entries,
      };
    }
    throw new Error(
      "page aggregate repository read contention exhausted retries",
    );
  }

  async #read_claimed_endpoint_state(
    endpoint_set: PageEndpointSet,
  ): Promise<ClaimedEndpointState> {
    const keys = [endpoint_set.canonical, ...endpoint_set.alternates].map(
      (binding) => page_endpoint_claim_key(binding.locator),
    );
    for (let attempt = 0; attempt < page_aggregate_max_attempts; attempt += 1) {
      const target_entries = await this.#get_entries(keys);
      const pointers = target_entries.map((entry) =>
        entry.versionstamp === null ? null : deserialize_pointer(entry.value)
      );
      const snapshots = new Map<PageId, StoredPageSnapshot>();
      for (const pointer of pointers) {
        if (pointer === null || snapshots.has(pointer.page_id)) continue;
        const snapshot = await this.#read_snapshot(pointer.page_id);
        if (snapshot !== null) snapshots.set(pointer.page_id, snapshot);
      }
      const current_entries = await this.#get_entries(keys);
      if (
        target_entries.some((entry, index) =>
          !same_entry_version(entry, current_entries[index])
        )
      ) {
        continue;
      }
      for (const [index, pointer] of pointers.entries()) {
        if (pointer === null) continue;
        const snapshot = snapshots.get(pointer.page_id);
        if (snapshot === undefined) invariant_violation();
        const snapshot_entry = snapshot.endpoint_entries.find((entry) =>
          key_equals(entry.key, keys[index])
        );
        if (
          snapshot_entry === undefined ||
          snapshot_entry.versionstamp !== target_entries[index].versionstamp ||
          snapshot.page.revision !== pointer.revision
        ) {
          invariant_violation();
        }
      }
      return { target_entries, snapshots };
    }
    throw new Error(
      "page aggregate repository read contention exhausted retries",
    );
  }

  #claimed_check_entries(
    state: ClaimedEndpointState,
  ): Deno.KvEntryMaybe<unknown>[] {
    return [
      ...state.target_entries,
      ...[...state.snapshots.values()].flatMap((snapshot) => [
        snapshot.entry,
        ...snapshot.index_entries,
      ]),
    ];
  }

  async #read_destination_projections(
    page: PageAggregate,
    authoritative_entry: Deno.KvEntryMaybe<unknown>,
    reusable: StoredPageSnapshot | null,
  ): Promise<Deno.KvEntryMaybe<unknown>[] | null> {
    const keys = projection_keys(page);
    const entries = await this.#get_entries(keys);
    for (const entry of entries) {
      const reusable_entry = reusable?.index_entries.find((candidate) =>
        key_equals(candidate.key, entry.key)
      );
      if (reusable_entry !== undefined) {
        if (!same_entry_version(reusable_entry, entry)) return null;
        continue;
      }
      if (entry.versionstamp === null) continue;
      const current_authority = await this.#kv.get<unknown>(
        authoritative_entry.key,
      );
      if (!same_entry_version(authoritative_entry, current_authority)) {
        return null;
      }
      invariant_violation();
    }
    return entries;
  }

  #merge_checks(
    entries: readonly Deno.KvEntryMaybe<unknown>[],
  ): Deno.KvEntryMaybe<unknown>[] | null {
    const merged: Deno.KvEntryMaybe<unknown>[] = [];
    for (const entry of entries) {
      const existing = merged.find((candidate) =>
        key_equals(candidate.key, entry.key)
      );
      if (existing === undefined) {
        merged.push(entry);
      } else if (existing.versionstamp !== entry.versionstamp) {
        return null;
      }
    }
    return merged;
  }

  async #commit(
    checks: readonly Deno.KvEntryMaybe<unknown>[],
    mutate: (atomic: Deno.AtomicOperation) => Deno.AtomicOperation,
  ): Promise<boolean> {
    if (checks.length > max_page_aggregate_atomic_checks) {
      throw new Error(
        "page aggregate repository invariant violated: atomic check budget exceeded",
      );
    }
    let atomic = this.#kv.native_atomic();
    for (const entry of checks) atomic = atomic.check(entry);
    return (await mutate(atomic).commit()).ok;
  }

  #replace_visibility(
    atomic: Deno.AtomicOperation,
    page: PageAggregate,
    replaced: readonly StoredPageSnapshot[],
  ): Deno.AtomicOperation {
    const next_indexes = visibility_index_values(page);
    const unique_replaced = new Map<PageId, StoredPageSnapshot>();
    for (const snapshot of replaced) {
      unique_replaced.set(snapshot.page.page_id, snapshot);
    }
    for (const snapshot of unique_replaced.values()) {
      if (snapshot.page.page_id !== page.page_id) {
        atomic.delete(snapshot.entry.key);
      }
      for (const entry of snapshot.index_entries) {
        if (!next_indexes.some((next) => key_equals(next.key, entry.key))) {
          atomic.delete(entry.key);
        }
      }
    }
    atomic.set(
      page_aggregate_storage_key(page.page_id),
      serialize_envelope(page),
    );
    for (const index of next_indexes) atomic.set(index.key, index.value);
    return atomic;
  }

  async #get_entries(
    keys: readonly Deno.KvKey[],
  ): Promise<Deno.KvEntryMaybe<unknown>[]> {
    return await Promise.all(keys.map((key) => this.#kv.get<unknown>(key)));
  }

  async #entry_changed(entry: Deno.KvEntry<unknown>): Promise<boolean> {
    return !same_entry_version(entry, await this.#kv.get<unknown>(entry.key));
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

  #require_locator(locator: Locator): void {
    require(
      typeof locator === "object" && locator !== null &&
        typeof locator.namespace === "string" && locator.namespace !== "" &&
        (locator.page_name === undefined ||
          (typeof locator.page_name === "string" && locator.page_name !== "")),
      "locator must have a non-empty namespace and optional non-empty page_name",
    );
  }

  #require_owner(owner_user_id: string): void {
    require(
      typeof owner_user_id === "string" && owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
  }

  #require_time(now: Date): void {
    require(is_valid_stored_date(now), "now must be a valid date");
  }

  #write_contention_exhausted(): never {
    throw new Error(
      "page aggregate repository write contention exhausted retries",
    );
  }
}
