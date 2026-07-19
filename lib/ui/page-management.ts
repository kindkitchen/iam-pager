import { format_page_etag } from "../page/etag.ts";
import type { ManagedPageLister, PageSummary } from "../page/interfaces.ts";
import type { PageAccess } from "../page/model.ts";
import type { Session } from "../session/model.ts";

/**
 * Serializable owner-safe management row shared by the server presenter and
 * the island. Field names and formats match the `/api/pages` summaries, so a
 * row can be refreshed from any API response without translation drift.
 */
export interface PageManagementSummary {
  readonly page_id: string;
  readonly path: string;
  readonly access: PageAccess;
  readonly content_type: string;
  readonly size_bytes: number;
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
    path: page.path,
    access: page.access,
    content_type: page.content_type,
    size_bytes: page.size_bytes,
    updated_at: page.updated_at.toISOString(),
    revision: page.revision,
    etag: format_page_etag(page.page_id, page.revision),
    management_url: `/api/pages/${page.page_id}`,
  };
}

/**
 * Validates one managed summary object from an API response. Extra fields
 * (locator, created_at, content) are ignored; a malformed object yields null
 * so the island can surface an error instead of rendering broken rows.
 */
export function management_summary_from_api(
  value: unknown,
): PageManagementSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const {
    page_id,
    path,
    access,
    content_type,
    size_bytes,
    updated_at,
    revision,
    etag,
    management_url,
  } = record;
  if (
    typeof page_id !== "string" || page_id === "" ||
    typeof path !== "string" || path === "" ||
    (access !== "public" && access !== "private") ||
    typeof content_type !== "string" || content_type === "" ||
    typeof size_bytes !== "number" || !Number.isSafeInteger(size_bytes) ||
    typeof updated_at !== "string" || updated_at === "" ||
    typeof revision !== "number" || !Number.isSafeInteger(revision) ||
    typeof etag !== "string" || etag === "" ||
    typeof management_url !== "string" || management_url === ""
  ) {
    return null;
  }
  return {
    page_id,
    path,
    access,
    content_type,
    size_bytes,
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

export interface PreparedManagedRequest {
  readonly url: string;
  readonly method: "GET" | "PATCH" | "DELETE";
  readonly headers: Headers;
  readonly body?: {
    readonly access?: PageAccess;
    readonly content?: {
      readonly content_type: "md-page";
      readonly input: { readonly md: string; readonly css?: string };
    };
  };
}

/** Builds the bounded continuation request for the managed list. */
export function prepare_managed_list_request(
  options: { readonly cursor?: string; readonly limit?: number } = {},
): PreparedManagedRequest {
  const query = new URLSearchParams();
  query.set("limit", String(options.limit ?? page_management_page_size));
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  return {
    url: `/api/pages?${query}`,
    method: "GET",
    headers: new Headers(),
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
    readonly content?: ManagedMdPageDraft;
  },
  csrf_token: string,
): PreparedManagedRequest {
  if (patch.access === undefined && patch.content === undefined) {
    throw new Error("managed update requires access, content, or both");
  }
  return {
    url: target.management_url,
    method: "PATCH",
    headers: new Headers({
      "content-type": "application/json",
      "x-csrf-token": csrf_token,
      "if-match": target.etag,
    }),
    body: {
      ...(patch.access === undefined ? {} : { access: patch.access }),
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

/** Builds the revision-bound bodyless DELETE request for one managed page. */
export function prepare_managed_delete_request(
  target: ManagedPageTarget,
  csrf_token: string,
): PreparedManagedRequest {
  return {
    url: target.management_url,
    method: "DELETE",
    headers: new Headers({
      "x-csrf-token": csrf_token,
      "if-match": target.etag,
    }),
  };
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

function format_scaled(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
