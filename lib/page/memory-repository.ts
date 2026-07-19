import { type Locator, locator_key } from "../locator/model.ts";
import {
  compare_page_sort_keys,
  decode_page_list_cursor,
  encode_page_list_cursor,
  page_sort_key,
  type PageSortKey,
} from "./cursor.ts";
import type {
  CreateManagedRequest,
  CreateManagedResult,
  DeleteManagedRequest,
  DeleteManagedResult,
  ListManagedRequest,
  ListManagedResult,
  PageRepository,
  PutTrialRequest,
  PutTrialResult,
  ReplaceManagedRequest,
  ReplaceManagedResult,
} from "./interfaces.ts";
import {
  is_valid_page_access,
  is_valid_page_id,
  is_valid_page_revision,
  page_record_violation,
  type PageId,
  type PageRecord,
} from "./model.ts";

function require(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`page repository: ${message}`);
}

function is_valid_time(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/** Boundary isolation: callers can never alias internal repository state. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Map-backed `PageRepository`. Every conditional mutation runs its complete
 * check/set phase synchronously (methods contain no awaits), so concurrent
 * promises serialize on the event loop and each mutation is atomic. Values
 * are cloned at both boundaries.
 */
export class MemoryPageRepository implements PageRepository {
  #by_id = new Map<PageId, PageRecord>();
  #by_locator = new Map<string, PageId>();

  // deno-lint-ignore require-await
  async find_by_locator(locator: Locator): Promise<PageRecord | null> {
    const page_id = this.#by_locator.get(locator_key(locator));
    return page_id === undefined ? null : clone(this.#by_id.get(page_id)!);
  }

  // deno-lint-ignore require-await
  async find_by_id(page_id: PageId): Promise<PageRecord | null> {
    require(
      is_valid_page_id(page_id),
      "page_id must be a route-safe opaque id",
    );
    const record = this.#by_id.get(page_id);
    return record === undefined ? null : clone(record);
  }

  // deno-lint-ignore require-await
  async put_trial(request: PutTrialRequest): Promise<PutTrialResult> {
    require(
      is_valid_page_id(request.page_id),
      "page_id must be a route-safe opaque id",
    );
    require(is_valid_time(request.now), "now must be a valid date");
    const key = locator_key(request.locator);
    const existing_id = this.#by_locator.get(key);
    if (existing_id !== undefined) {
      const existing = this.#by_id.get(existing_id)!;
      if (existing.stewardship.kind === "managed") {
        return { ok: false, reason: "managed_conflict" };
      }
      const page: PageRecord = {
        page_id: existing.page_id,
        locator: clone(request.locator),
        stewardship: { kind: "trial" },
        access: "public",
        revision: existing.revision + 1,
        content: clone(request.content),
        created_at: existing.created_at,
        updated_at: request.now,
      };
      this.#assert_valid(page);
      this.#by_id.set(page.page_id, page);
      this.#by_locator.set(key, page.page_id);
      return { ok: true, outcome: "replaced", page: clone(page) };
    }
    if (this.#by_id.has(request.page_id)) {
      return { ok: false, reason: "page_id_conflict" };
    }
    const page: PageRecord = {
      page_id: request.page_id,
      locator: clone(request.locator),
      stewardship: { kind: "trial" },
      access: "public",
      revision: 1,
      content: clone(request.content),
      created_at: request.now,
      updated_at: request.now,
    };
    this.#assert_valid(page);
    this.#by_id.set(page.page_id, page);
    this.#by_locator.set(key, page.page_id);
    return { ok: true, outcome: "created", page: clone(page) };
  }

  // deno-lint-ignore require-await
  async create_managed(
    request: CreateManagedRequest,
  ): Promise<CreateManagedResult> {
    require(
      is_valid_page_id(request.page_id),
      "page_id must be a route-safe opaque id",
    );
    require(
      typeof request.owner_user_id === "string" &&
        request.owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
    require(
      is_valid_page_access(request.access),
      "access must be public or private",
    );
    require(is_valid_time(request.now), "now must be a valid date");
    const key = locator_key(request.locator);
    const existing_id = this.#by_locator.get(key);
    let replaced_trial_id: PageId | null = null;
    if (existing_id !== undefined) {
      const existing = this.#by_id.get(existing_id)!;
      if (existing.stewardship.kind === "managed") {
        return { ok: false, reason: "managed_conflict" };
      }
      replaced_trial_id = existing_id;
    }
    if (this.#by_id.has(request.page_id)) {
      return { ok: false, reason: "page_id_conflict" };
    }
    const page: PageRecord = {
      page_id: request.page_id,
      locator: clone(request.locator),
      stewardship: { kind: "managed", owner_user_id: request.owner_user_id },
      access: request.access,
      revision: 1,
      content: clone(request.content),
      created_at: request.now,
      updated_at: request.now,
    };
    this.#assert_valid(page);
    if (replaced_trial_id !== null) this.#by_id.delete(replaced_trial_id);
    this.#by_id.set(page.page_id, page);
    this.#by_locator.set(key, page.page_id);
    return {
      ok: true,
      outcome: replaced_trial_id === null ? "created" : "replaced_trial",
      page: clone(page),
    };
  }

  // deno-lint-ignore require-await
  async replace_managed(
    request: ReplaceManagedRequest,
  ): Promise<ReplaceManagedResult> {
    require(
      is_valid_page_id(request.page_id),
      "page_id must be a route-safe opaque id",
    );
    require(
      typeof request.owner_user_id === "string" &&
        request.owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
    require(
      is_valid_page_revision(request.expected_revision),
      "expected_revision must be a positive safe integer",
    );
    require(
      is_valid_page_access(request.access),
      "access must be public or private",
    );
    require(is_valid_time(request.now), "now must be a valid date");
    const existing = this.#by_id.get(request.page_id);
    if (
      existing === undefined ||
      existing.stewardship.kind !== "managed" ||
      existing.stewardship.owner_user_id !== request.owner_user_id
    ) {
      return { ok: false, reason: "not_found" };
    }
    if (existing.revision !== request.expected_revision) {
      return { ok: false, reason: "revision_conflict" };
    }
    const page: PageRecord = {
      page_id: existing.page_id,
      locator: existing.locator,
      stewardship: existing.stewardship,
      access: request.access,
      revision: existing.revision + 1,
      content: request.content === undefined
        ? existing.content
        : clone(request.content),
      created_at: existing.created_at,
      updated_at: request.now,
    };
    this.#assert_valid(page);
    this.#by_id.set(page.page_id, page);
    return { ok: true, page: clone(page) };
  }

  // deno-lint-ignore require-await
  async delete_managed(
    request: DeleteManagedRequest,
  ): Promise<DeleteManagedResult> {
    require(
      is_valid_page_id(request.page_id),
      "page_id must be a route-safe opaque id",
    );
    require(
      typeof request.owner_user_id === "string" &&
        request.owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
    require(
      is_valid_page_revision(request.expected_revision),
      "expected_revision must be a positive safe integer",
    );
    const existing = this.#by_id.get(request.page_id);
    if (
      existing === undefined ||
      existing.stewardship.kind !== "managed" ||
      existing.stewardship.owner_user_id !== request.owner_user_id
    ) {
      return { ok: false, reason: "not_found" };
    }
    if (existing.revision !== request.expected_revision) {
      return { ok: false, reason: "revision_conflict" };
    }
    this.#by_id.delete(existing.page_id);
    this.#by_locator.delete(locator_key(existing.locator));
    return { ok: true };
  }

  // deno-lint-ignore require-await
  async list_managed(request: ListManagedRequest): Promise<ListManagedResult> {
    require(
      typeof request.owner_user_id === "string" &&
        request.owner_user_id !== "",
      "owner_user_id must be non-empty",
    );
    require(
      Number.isSafeInteger(request.limit) && request.limit >= 1,
      "limit must be a positive safe integer",
    );
    require(
      request.namespace === undefined ||
        (typeof request.namespace === "string" && request.namespace !== ""),
      "namespace filter must be non-empty when present",
    );
    const filter = request.namespace === undefined
      ? null
      : request.namespace.toLowerCase();
    let after: PageSortKey | null = null;
    if (request.cursor !== undefined) {
      after = decode_page_list_cursor(request.cursor, filter);
      if (after === null) return { ok: false, reason: "invalid_cursor" };
    }
    const candidates: { key: PageSortKey; record: PageRecord }[] = [];
    for (const record of this.#by_id.values()) {
      if (record.stewardship.kind !== "managed") continue;
      if (record.stewardship.owner_user_id !== request.owner_user_id) continue;
      const key = page_sort_key(record);
      if (filter !== null && key.namespace_key !== filter) continue;
      if (after !== null && compare_page_sort_keys(key, after) <= 0) continue;
      candidates.push({ key, record });
    }
    candidates.sort((a, b) => compare_page_sort_keys(a.key, b.key));
    const selected = candidates.slice(0, request.limit);
    const next_cursor = candidates.length > request.limit
      ? encode_page_list_cursor(selected[selected.length - 1].key, filter)
      : null;
    return {
      ok: true,
      pages: selected.map((entry) => clone(entry.record)),
      next_cursor,
    };
  }

  #assert_valid(page: PageRecord): void {
    const violation = page_record_violation(page);
    if (violation !== null) throw new Error(`page repository: ${violation}`);
  }
}
