import { type Locator, locator_key } from "../locator/model.ts";
import {
  is_safe_page_path,
  page_endpoint_set_violation,
  type PageEndpointLink,
  type PageEndpointLinks,
} from "../page/endpoint.ts";
import { format_page_etag, parse_page_etag } from "../page/etag.ts";
import {
  type ManagedPageLister,
  type ManagedPageRevisionSelection,
  max_bulk_managed_pages,
  type PageSummary,
} from "../page/interfaces.ts";
import {
  is_valid_page_id,
  is_valid_page_revision,
  is_valid_page_tags,
  type PageAccess,
} from "../page/model.ts";
import type { Session } from "../session/model.ts";

/**
 * Serializable owner-safe management row shared by the server presenter and
 * the island. Field names and formats match the `/api/pages` summaries, so a
 * row can be refreshed from any API response without translation drift.
 */
export interface PageManagementSummary {
  readonly page_id: string;
  readonly locator: Locator;
  readonly path: string;
  readonly endpoints: PageEndpointLinks;
  readonly access: PageAccess;
  readonly content_type: string;
  readonly size_bytes: number;
  readonly tags: readonly string[];
  /** ISO timestamp; islands receive it across the serialization boundary. */
  readonly updated_at: string;
  readonly revision: number;
  /** Exact strong validator accepted by `If-Match` on the management API. */
  readonly etag: string;
  readonly management_url: string;
}

/** Complete server-owned model for the creator page-management panel. */
export type PageManagementPanel =
  | { readonly kind: "hidden" }
  | {
    readonly kind: "creator";
    /** Synchronizer token management mutations must send back to the API. */
    readonly csrf_token: string;
    readonly pages: readonly PageManagementSummary[];
    readonly next_cursor: string | null;
  };

export interface PageManagementPanelPresenter {
  present(session: Session): Promise<PageManagementPanel>;
}

/** One UI page of managed rows; continuation goes through the API cursor. */
export const page_management_page_size = 20;

export interface CreatorPageManagementPresenterOptions {
  readonly pages: ManagedPageLister;
  /** Override only in tests; HTTP bounds stay 1-100. */
  readonly page_size?: number;
}

/**
 * Keeps session decisions and managed listing outside UI components: guests
 * get a hidden panel, creators get their first page of rows plus the trusted
 * CSRF token, and the island continues through the same `/api/pages`
 * contracts (DS-PROTECT).
 */
export class CreatorPageManagementPresenter
  implements PageManagementPanelPresenter {
  readonly #pages: ManagedPageLister;
  readonly #page_size: number;

  constructor(options: CreatorPageManagementPresenterOptions) {
    this.#pages = options.pages;
    this.#page_size = options.page_size ?? page_management_page_size;
  }

  async present(session: Session): Promise<PageManagementPanel> {
    if (session.kind !== "authenticated") return { kind: "hidden" };
    const result = await this.#pages.list_managed({
      actor: { kind: "user", user_id: session.user_id },
      limit: this.#page_size,
    });
    if (!result.ok) {
      throw new Error(`managed page listing failed: ${result.reason}`);
    }
    return {
      kind: "creator",
      csrf_token: session.csrf_token,
      pages: result.pages.map(present_management_summary),
      next_cursor: result.next_cursor,
    };
  }
}

/** Maps a service summary to the serializable row the panel renders. */
export function present_management_summary(
  page: PageSummary,
): PageManagementSummary {
  return {
    page_id: page.page_id,
    locator: structuredClone(page.locator),
    path: page.path,
    endpoints: structuredClone(page.endpoints),
    access: page.access,
    content_type: page.content_type,
    size_bytes: page.size_bytes,
    tags: [...page.tags],
    updated_at: page.updated_at.toISOString(),
    revision: page.revision,
    etag: format_page_etag(page.page_id, page.revision),
    management_url: `/api/pages/${page.page_id}`,
  };
}

/**
 * Validates one managed summary object from an API response. Extra fields
 * (created_at and editable content) are ignored; a malformed object yields null
 * so the island can surface an error instead of rendering broken rows.
 */
export function management_summary_from_api(
  value: unknown,
): PageManagementSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const {
    page_id,
    locator,
    path,
    endpoints,
    access,
    content_type,
    size_bytes,
    tags,
    updated_at,
    revision,
    etag,
    management_url,
  } = record;
  const parsed_endpoints = management_endpoint_links(endpoints);
  if (
    typeof page_id !== "string" || !is_valid_page_id(page_id) ||
    !is_management_locator(locator) || !is_safe_page_path(path) ||
    parsed_endpoints === null ||
    locator_key(parsed_endpoints.canonical.locator) !== locator_key(locator) ||
    parsed_endpoints.canonical.path !== path ||
    (access !== "public" && access !== "private") ||
    typeof content_type !== "string" || content_type === "" ||
    typeof size_bytes !== "number" || !Number.isSafeInteger(size_bytes) ||
    size_bytes < 0 || !is_valid_page_tags(tags) ||
    typeof updated_at !== "string" || !is_iso_timestamp(updated_at) ||
    typeof revision !== "number" || !is_valid_page_revision(revision) ||
    typeof etag !== "string" ||
    parse_page_etag(etag)?.page_id !== page_id ||
    parse_page_etag(etag)?.revision !== revision ||
    management_url !== `/api/pages/${page_id}`
  ) {
    return null;
  }
  return {
    page_id,
    locator: structuredClone(locator),
    path,
    endpoints: parsed_endpoints,
    access,
    content_type,
    size_bytes,
    tags: [...tags],
    updated_at,
    revision,
    etag,
    management_url,
  };
}

/** Address of one managed representation: where to send it and which one. */
export interface ManagedPageTarget {
  readonly management_url: string;
  readonly etag: string;
}

/** Editable md-page source held by the management editor. */
export interface ManagedMdPageDraft {
  readonly markdown: string;
  readonly css: string;
}

export interface ManagedPageFilters {
  readonly name?: string;
  readonly access?: PageAccess;
  readonly tag?: string;
}

interface ManagedUpdateBody {
  readonly access?: PageAccess;
  readonly tags?: readonly string[];
  readonly content?: {
    readonly content_type: "md-page";
    readonly input: { readonly md: string; readonly css?: string };
  };
}

interface ManagedRenameBody {
  readonly page_name?: string;
}

interface ManagedBulkAccessBody {
  readonly access: PageAccess;
  readonly selection: readonly ManagedPageRevisionSelection[];
}

interface ManagedBulkDeleteBody {
  readonly selection: readonly ManagedPageRevisionSelection[];
}

export interface PreparedManagedRequest {
  readonly url: string;
  readonly method: "GET" | "PATCH" | "DELETE" | "POST";
  readonly headers: Headers;
  readonly body?:
    | ManagedUpdateBody
    | ManagedRenameBody
    | ManagedBulkAccessBody
    | ManagedBulkDeleteBody;
}

/** Builds one filter-bound bounded page of the managed list. */
export function prepare_managed_list_request(
  options: {
    readonly cursor?: string;
    readonly limit?: number;
    readonly filters?: ManagedPageFilters;
  } = {},
): PreparedManagedRequest {
  const query = new URLSearchParams();
  query.set("limit", String(options.limit ?? page_management_page_size));
  const name = options.filters?.name?.trim();
  const tag = options.filters?.tag?.trim();
  if (name !== undefined && name !== "") query.set("name", name);
  if (options.filters?.access !== undefined) {
    query.set("access", options.filters.access);
  }
  if (tag !== undefined && tag !== "") query.set("tag", tag);
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  return {
    url: `/api/pages?${query}`,
    method: "GET",
    headers: new Headers(),
  };
}

/** Validates one complete managed-list response for the island boundary. */
export function managed_list_from_api(value: unknown): {
  readonly pages: PageManagementSummary[];
  readonly next_cursor: string | null;
} | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || !Array.isArray(record.pages)) return null;
  const pages = record.pages.map(management_summary_from_api);
  if (pages.some((page) => page === null)) return null;
  if (
    record.next_cursor !== null && typeof record.next_cursor !== "string"
  ) {
    return null;
  }
  return {
    pages: pages as PageManagementSummary[],
    next_cursor: record.next_cursor,
  };
}

/** Builds the owner inspection request for one managed page. */
export function prepare_managed_inspect_request(
  management_url: string,
): PreparedManagedRequest {
  return { url: management_url, method: "GET", headers: new Headers() };
}

/**
 * Maps editor state to the revision-bound PATCH contract: exact `If-Match`,
 * synchronizer CSRF, and only the supplied fields. An empty patch is a
 * programming error and throws before any request is produced.
 */
export function prepare_managed_update_request(
  target: ManagedPageTarget,
  patch: {
    readonly access?: PageAccess;
    readonly tags?: readonly string[];
    readonly content?: ManagedMdPageDraft;
  },
  csrf_token: string,
): PreparedManagedRequest {
  if (
    patch.access === undefined && patch.tags === undefined &&
    patch.content === undefined
  ) {
    throw new Error("managed update requires access, tags, or content");
  }
  return {
    url: target.management_url,
    method: "PATCH",
    headers: json_mutation_headers(csrf_token, target.etag),
    body: {
      ...(patch.access === undefined ? {} : { access: patch.access }),
      ...(patch.tags === undefined ? {} : { tags: [...patch.tags] }),
      ...(patch.content === undefined ? {} : {
        content: {
          content_type: "md-page" as const,
          input: {
            md: patch.content.markdown,
            ...(patch.content.css === "" ? {} : { css: patch.content.css }),
          },
        },
      }),
    },
  };
}

/** Builds the revision-bound same-namespace rename request. */
export function prepare_managed_rename_request(
  target: ManagedPageTarget,
  page_name: string | undefined,
  csrf_token: string,
): PreparedManagedRequest {
  return {
    url: `${target.management_url}/rename`,
    method: "POST",
    headers: json_mutation_headers(csrf_token, target.etag),
    body: page_name === undefined ? {} : { page_name },
  };
}

/** Builds the revision-bound bodyless duplicate request. */
export function prepare_managed_duplicate_request(
  target: ManagedPageTarget,
  csrf_token: string,
): PreparedManagedRequest {
  return {
    url: `${target.management_url}/duplicate`,
    method: "POST",
    headers: revision_mutation_headers(csrf_token, target.etag),
  };
}

/** Builds the revision-bound bodyless DELETE request for one managed page. */
export function prepare_managed_delete_request(
  target: ManagedPageTarget,
  csrf_token: string,
): PreparedManagedRequest {
  return {
    url: target.management_url,
    method: "DELETE",
    headers: revision_mutation_headers(csrf_token, target.etag),
  };
}

/** Uses current visible revisions for an explicit row selection. */
export function managed_revision_selection(
  pages: readonly PageManagementSummary[],
  selected_page_ids: ReadonlySet<string>,
): ManagedPageRevisionSelection[] {
  const selection = pages
    .filter((page) => selected_page_ids.has(page.page_id))
    .map((page) => ({
      page_id: page.page_id,
      expected_revision: page.revision,
    }));
  validate_bulk_selection(selection);
  return selection;
}

/** Builds one per-page-result bulk access request. */
export function prepare_managed_bulk_access_request(
  selection: readonly ManagedPageRevisionSelection[],
  access: PageAccess,
  csrf_token: string,
): PreparedManagedRequest {
  validate_bulk_selection(selection);
  return {
    url: "/api/pages/bulk/access",
    method: "POST",
    headers: json_mutation_headers(csrf_token),
    body: { access, selection: selection.map((item) => ({ ...item })) },
  };
}

/** Builds one per-page-result bulk deletion request. */
export function prepare_managed_bulk_delete_request(
  selection: readonly ManagedPageRevisionSelection[],
  csrf_token: string,
): PreparedManagedRequest {
  validate_bulk_selection(selection);
  return {
    url: "/api/pages/bulk/delete",
    method: "POST",
    headers: json_mutation_headers(csrf_token),
    body: { selection: selection.map((item) => ({ ...item })) },
  };
}

export type ManagedBulkAccessItem =
  | {
    readonly page_id: string;
    readonly ok: true;
    readonly page: PageManagementSummary;
  }
  | {
    readonly page_id: string;
    readonly ok: false;
    readonly error: "not_found" | "revision_conflict" | "revision_exhausted";
  };

export type ManagedBulkDeleteItem =
  | { readonly page_id: string; readonly ok: true }
  | {
    readonly page_id: string;
    readonly ok: false;
    readonly error: "not_found" | "revision_conflict";
  };

/** Validates ordered bulk-access outcomes before UI state is changed. */
export function managed_bulk_access_from_api(
  value: unknown,
): ManagedBulkAccessItem[] | null {
  return managed_bulk_results_from_api(value, true) as
    | ManagedBulkAccessItem[]
    | null;
}

/** Validates ordered bulk-delete outcomes before UI state is changed. */
export function managed_bulk_delete_from_api(
  value: unknown,
): ManagedBulkDeleteItem[] | null {
  return managed_bulk_results_from_api(value, false) as
    | ManagedBulkDeleteItem[]
    | null;
}

/** Splits the creator-facing comma list; server normalization stays authoritative. */
export function managed_tags_from_input(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter((tag) => tag !== "");
}

/** Mirrors the managed list's name/access/tag semantics for local action results. */
export function management_summary_matches_filters(
  page: PageManagementSummary,
  filters: ManagedPageFilters,
): boolean {
  const name = filters.name?.trim().toLowerCase();
  const tag = filters.tag?.trim().toLowerCase();
  return (
    (name === undefined || name === "" ||
      (page.locator.page_name !== undefined &&
        page.locator.page_name.toLowerCase().includes(name))) &&
    (filters.access === undefined || page.access === filters.access) &&
    (tag === undefined || tag === "" || page.tags.includes(tag))
  );
}

/**
 * Reads editable md-page source out of an inspection response. Returns null
 * for any other shape so unsupported content types degrade to a clear
 * message instead of a broken editor.
 */
export function managed_md_page_draft(
  content: unknown,
): ManagedMdPageDraft | null {
  if (typeof content !== "object" || content === null) return null;
  const record = content as Record<string, unknown>;
  if (record.content_type !== "md-page") return null;
  if (typeof record.input !== "object" || record.input === null) return null;
  const input = record.input as Record<string, unknown>;
  if (typeof input.md !== "string") return null;
  if (input.css !== undefined && typeof input.css !== "string") return null;
  return { markdown: input.md, css: input.css ?? "" };
}

/** Human size for management rows; exact bytes below one KiB. */
export function format_size_bytes(size_bytes: number): string {
  if (!Number.isSafeInteger(size_bytes) || size_bytes < 0) {
    throw new Error("size_bytes must be a non-negative safe integer");
  }
  if (size_bytes < 1024) return `${size_bytes} B`;
  const kib = size_bytes / 1024;
  if (kib < 1024) return `${format_scaled(kib)} KiB`;
  return `${format_scaled(kib / 1024)} MiB`;
}

function management_endpoint_links(
  value: unknown,
): PageEndpointLinks | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.alternates)) return null;
  const canonical = management_endpoint_link(record.canonical);
  const alternates = record.alternates.map(management_endpoint_link);
  if (canonical === null || alternates.some((link) => link === null)) {
    return null;
  }
  const typed_alternates = alternates as PageEndpointLink[];
  if (
    page_endpoint_set_violation({
      canonical: {
        locator: canonical.locator,
        delivery_profile: canonical.delivery_profile,
      },
      alternates: typed_alternates.map((link) => ({
        locator: link.locator,
        delivery_profile: link.delivery_profile,
      })),
    }) !== null
  ) {
    return null;
  }
  const paths = [canonical.path, ...typed_alternates.map((link) => link.path)];
  if (new Set(paths).size !== paths.length) return null;
  return {
    canonical: structuredClone(canonical),
    alternates: structuredClone(typed_alternates),
  };
}

function management_endpoint_link(value: unknown): PageEndpointLink | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !is_management_locator(record.locator) ||
    !is_safe_page_path(record.path) ||
    (record.delivery_profile !== "inline" &&
      record.delivery_profile !== "attachment")
  ) {
    return null;
  }
  return {
    locator: structuredClone(record.locator),
    path: record.path,
    delivery_profile: record.delivery_profile,
  };
}

function is_management_locator(value: unknown): value is Locator {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.namespace === "string" && record.namespace !== "" &&
    (record.page_name === undefined ||
      (typeof record.page_name === "string" && record.page_name !== ""));
}

function is_iso_timestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function revision_mutation_headers(
  csrf_token: string,
  etag?: string,
): Headers {
  const headers = new Headers({ "x-csrf-token": csrf_token });
  if (etag !== undefined) headers.set("if-match", etag);
  return headers;
}

function json_mutation_headers(
  csrf_token: string,
  etag?: string,
): Headers {
  const headers = revision_mutation_headers(csrf_token, etag);
  headers.set("content-type", "application/json");
  return headers;
}

function validate_bulk_selection(
  selection: readonly ManagedPageRevisionSelection[],
): void {
  if (
    selection.length === 0 || selection.length > max_bulk_managed_pages
  ) {
    throw new Error(
      `managed bulk selection requires 1-${max_bulk_managed_pages} pages`,
    );
  }
  const page_ids = new Set<string>();
  for (const item of selection) {
    if (
      !is_valid_page_id(item.page_id) ||
      !is_valid_page_revision(item.expected_revision) ||
      page_ids.has(item.page_id)
    ) {
      throw new Error("managed bulk selection contains an invalid page");
    }
    page_ids.add(item.page_id);
  }
}

function managed_bulk_results_from_api(
  value: unknown,
  includes_page: boolean,
): Array<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  if (body.ok !== true || !Array.isArray(body.results)) return null;
  const results: Array<Record<string, unknown>> = [];
  for (const result of body.results) {
    if (typeof result !== "object" || result === null) return null;
    const item = result as Record<string, unknown>;
    if (typeof item.page_id !== "string" || !is_valid_page_id(item.page_id)) {
      return null;
    }
    if (item.ok === true) {
      if (includes_page) {
        const page = management_summary_from_api(item.page);
        if (page === null || page.page_id !== item.page_id) return null;
        results.push({ page_id: item.page_id, ok: true, page });
      } else {
        results.push({ page_id: item.page_id, ok: true });
      }
      continue;
    }
    if (item.ok !== false || typeof item.error !== "string") return null;
    const allowed_errors = includes_page
      ? ["not_found", "revision_conflict", "revision_exhausted"]
      : ["not_found", "revision_conflict"];
    if (!allowed_errors.includes(item.error)) return null;
    results.push({ page_id: item.page_id, ok: false, error: item.error });
  }
  return results;
}

function format_scaled(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
