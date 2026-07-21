import type { DeliveryPayload } from "../content/model.ts";
import { type Locator, locator_key } from "../locator/model.ts";
import type { PageEndpointLink } from "../page/endpoint.ts";
import type {
  PublicPageLister,
  PublicPageSummary,
  PublicPageViewer,
} from "../page/interfaces.ts";

export interface PublicPageLink {
  readonly label: string;
  readonly direct_path: string;
  readonly site_path: string;
}

export type PublicContentPreview =
  | { readonly kind: "html"; readonly document: string }
  | {
    readonly kind: "pdf";
    readonly preview: PageEndpointLink;
    readonly downloads: readonly PageEndpointLink[];
    readonly size_bytes: number;
  }
  | {
    readonly kind: "fallback";
    readonly media_type: string;
    readonly size_bytes: number;
  };

export type PublicPageView =
  | { readonly kind: "missing" }
  | {
    readonly kind: "page";
    readonly page: PublicPageSummary;
    readonly direct_path: string;
    readonly preview: PublicContentPreview;
    readonly default_page: PublicPageLink | null;
    readonly other_pages: readonly PublicPageLink[];
    readonly has_more_public_pages: boolean;
  };

export interface PublicPageViewPresenter {
  present(locator: Locator): Promise<PublicPageView>;
}

export interface CreatorPublicPageViewPresenterOptions {
  readonly pages: PublicPageViewer & PublicPageLister;
  /** Maximum other-page links rendered by the wrapper. Defaults to 20. */
  readonly max_other_pages?: number;
}

/**
 * Web-independent public-view projection. Creator content is kept as an opaque
 * iframe document; only platform-owned metadata and links enter the wrapper's
 * DOM. Trial pages remain directly viewable but never gain creator listings.
 */
export class CreatorPublicPageViewPresenter implements PublicPageViewPresenter {
  readonly #pages: PublicPageViewer & PublicPageLister;
  readonly #max_other_pages: number;

  constructor(options: CreatorPublicPageViewPresenterOptions) {
    const max_other_pages = options.max_other_pages ?? 20;
    if (!Number.isSafeInteger(max_other_pages) || max_other_pages < 1) {
      throw new Error("max_other_pages must be a positive safe integer");
    }
    this.#pages = options.pages;
    this.#max_other_pages = max_other_pages;
  }

  async present(locator: Locator): Promise<PublicPageView> {
    const viewed = await this.#pages.view_public(locator);
    if (!viewed.ok) return { kind: "missing" };

    const page = viewed.page;
    const preview = preview_from_payload(page, viewed.payload);
    if (page.stewardship === "trial") {
      return {
        kind: "page",
        page,
        direct_path: page.path,
        preview,
        default_page: null,
        other_pages: [],
        has_more_public_pages: false,
      };
    }

    const default_page = locator.page_name === undefined
      ? null
      : await this.#default_page(page.locator.namespace);
    const listed = await this.#pages.list_public({
      namespace: page.locator.namespace,
      // Leave room for the current and default pages that are not "other".
      limit: this.#max_other_pages + 2,
    });
    const current_key = locator_key(page.locator);
    const default_key = default_page === null
      ? null
      : locator_key({ namespace: page.locator.namespace });
    const candidates = listed.ok
      ? listed.pages.filter((candidate) => {
        const key = locator_key(candidate.locator);
        return key !== current_key && key !== default_key;
      })
      : [];
    const other_pages = candidates.slice(0, this.#max_other_pages).map(
      public_page_link,
    );

    return {
      kind: "page",
      page,
      direct_path: page.path,
      preview,
      default_page,
      other_pages,
      has_more_public_pages: listed.ok &&
        (listed.next_cursor !== null ||
          candidates.length > this.#max_other_pages),
    };
  }

  async #default_page(namespace: string): Promise<PublicPageLink | null> {
    const viewed = await this.#pages.view_public({ namespace });
    if (!viewed.ok || viewed.page.stewardship !== "managed") return null;
    return public_page_link(viewed.page);
  }
}

function preview_from_payload(
  page: PublicPageSummary,
  payload: DeliveryPayload | null,
): PublicContentPreview {
  if (
    payload !== null && typeof payload.body === "string" &&
    payload.media_type.toLowerCase().startsWith("text/html")
  ) {
    return { kind: "html", document: payload.body };
  }
  if (
    page.content_type === "pdf" &&
    page.media_type.toLowerCase() === "application/pdf" &&
    page.endpoints.canonical.delivery_profile === "inline"
  ) {
    const downloads = page.endpoints.alternates.filter((endpoint) =>
      endpoint.delivery_profile === "attachment"
    );
    if (downloads.length > 0) {
      return {
        kind: "pdf",
        preview: structuredClone(page.endpoints.canonical),
        downloads: structuredClone(downloads),
        size_bytes: page.size_bytes,
      };
    }
  }
  return {
    kind: "fallback",
    media_type: page.media_type,
    size_bytes: page.size_bytes,
  };
}

function public_page_link(page: PublicPageSummary): PublicPageLink {
  return {
    label: page.locator.page_name ?? "Default page",
    direct_path: page.path,
    site_path: `/site${page.path}`,
  };
}
