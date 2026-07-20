import type { PageEndpointLinks } from "../page/endpoint.ts";
import type {
  ExplorePublicPagesRequest,
  PublicPageExplorer,
  PublicPageSummary,
} from "../page/interfaces.ts";

export interface PublicExplorationInput {
  readonly namespace_query?: string;
  readonly page_name_query?: string;
  readonly tag?: string;
  readonly cursor?: string;
}

export interface PublicExplorationItem {
  readonly namespace: string;
  readonly page_name: string | null;
  readonly label: string;
  readonly direct_path: string;
  readonly site_path: string;
  readonly endpoints: PageEndpointLinks;
  readonly content_type: string;
  readonly size_bytes: number;
  readonly tags: readonly string[];
  readonly updated_at: Date;
}

export interface PublicExploration {
  readonly namespace_query: string;
  readonly page_name_query: string;
  readonly tag: string;
  readonly is_search: boolean;
  readonly pages: readonly PublicExplorationItem[];
  readonly next_path: string | null;
  readonly error: "invalid_query" | "invalid_cursor" | null;
}

export interface PublicExplorationPresenter {
  present(input?: PublicExplorationInput): Promise<PublicExploration>;
}

export interface SitePublicExplorationPresenterOptions {
  readonly pages: PublicPageExplorer;
  /** Maximum rows projected on one site response. Defaults to 20. */
  readonly max_results?: number;
}

/**
 * Web-independent DS-EXPLORE projection. Search and visibility stay in the
 * page capability; this presenter only supplies visitor-safe labels and links
 * for the site's GET form and continuation.
 */
export class SitePublicExplorationPresenter
  implements PublicExplorationPresenter {
  readonly #pages: PublicPageExplorer;
  readonly #max_results: number;

  constructor(options: SitePublicExplorationPresenterOptions) {
    const max_results = options.max_results ?? 20;
    if (!Number.isSafeInteger(max_results) || max_results < 1) {
      throw new Error("max_results must be a positive safe integer");
    }
    this.#pages = options.pages;
    this.#max_results = max_results;
  }

  async present(
    input: PublicExplorationInput = {},
  ): Promise<PublicExploration> {
    const namespace_query = input.namespace_query?.trim() ?? "";
    const page_name_query = input.page_name_query?.trim() ?? "";
    const tag = input.tag?.trim() ?? "";
    const is_search = namespace_query !== "" || page_name_query !== "" ||
      tag !== "";
    const request: ExplorePublicPagesRequest = {
      ...(namespace_query === "" ? {} : { namespace_query }),
      ...(page_name_query === "" ? {} : { page_name_query }),
      ...(tag === "" ? {} : { tag }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: this.#max_results,
    };
    const explored = await this.#pages.explore_public(request);
    if (!explored.ok) {
      return {
        namespace_query,
        page_name_query,
        tag,
        is_search,
        pages: [],
        next_path: null,
        error: explored.reason,
      };
    }
    return {
      namespace_query,
      page_name_query,
      tag,
      is_search,
      pages: explored.pages.map(public_exploration_item),
      next_path: explored.next_cursor === null ? null : exploration_path(
        namespace_query,
        page_name_query,
        tag,
        explored.next_cursor,
      ),
      error: null,
    };
  }
}

function public_exploration_item(
  page: PublicPageSummary,
): PublicExplorationItem {
  return {
    namespace: page.locator.namespace,
    page_name: page.locator.page_name ?? null,
    label: page.locator.page_name ?? "Default page",
    direct_path: page.path,
    site_path: `/site${page.path}`,
    endpoints: structuredClone(page.endpoints),
    content_type: page.content_type,
    size_bytes: page.size_bytes,
    tags: [...page.tags],
    updated_at: new Date(page.updated_at),
  };
}

function exploration_path(
  namespace_query: string,
  page_name_query: string,
  tag: string,
  cursor: string,
): string {
  const query = new URLSearchParams();
  if (namespace_query !== "") query.set("namespace", namespace_query);
  if (page_name_query !== "") query.set("page", page_name_query);
  if (tag !== "") query.set("tag", tag);
  query.set("cursor", cursor);
  return `/site?${query}`;
}
