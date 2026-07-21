import type {
  ExplorePublicPageAggregatesRequest,
  ListManagedPageAggregatesRequest,
} from "./aggregate-interfaces.ts";
import type { PageAggregate } from "./aggregate.ts";
import {
  type ManagedPageListCursorScope,
  page_sort_key,
  type PageExplorationCursorScope,
  type PageSortKey,
} from "./cursor.ts";
import { is_valid_page_access, is_valid_page_tags } from "./model.ts";

function require(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`page aggregate repository: ${message}`);
}

export function aggregate_sort_key(page: PageAggregate): PageSortKey {
  return page_sort_key({
    page_id: page.page_id,
    locator: page.endpoint_set.canonical.locator,
  });
}

export function require_positive_limit(limit: number): void {
  require(
    Number.isSafeInteger(limit) && limit >= 1,
    "limit must be a positive safe integer",
  );
}

export function require_normalized_managed_list_request(
  request: ListManagedPageAggregatesRequest,
): void {
  if (request.page_name_query !== undefined) {
    require(
      request.page_name_query !== "" &&
        request.page_name_query === request.page_name_query.trim() &&
        request.page_name_query === request.page_name_query.toLowerCase(),
      "page_name_query must be a normalized lowercase substring when present",
    );
  }
  require(
    request.access === undefined || is_valid_page_access(request.access),
    "access filter must be public or private when present",
  );
  require(
    request.tag === undefined || is_valid_page_tags([request.tag]),
    "tag filter must be canonical when present",
  );
}

export function matches_managed_list(
  page: PageAggregate,
  key: PageSortKey,
  scope: ManagedPageListCursorScope,
): boolean {
  return (scope.namespace === null || key.namespace_key === scope.namespace) &&
    (scope.page_name_query === null ||
      (key.default_rank === 1 &&
        key.page_name_key.includes(scope.page_name_query))) &&
    (scope.access === null || page.access === scope.access) &&
    (scope.tag === null || page.tags.includes(scope.tag));
}

export function require_normalized_exploration_request(
  request: ExplorePublicPageAggregatesRequest,
): void {
  require_positive_limit(request.limit);
  for (
    const [name, query] of [
      ["namespace_query", request.namespace_query],
      ["page_name_query", request.page_name_query],
    ] as const
  ) {
    require(
      query === undefined ||
        (query !== "" && query === query.trim() &&
          query === query.toLowerCase()),
      `${name} must be a normalized lowercase substring when present`,
    );
  }
  require(
    request.tag === undefined || is_valid_page_tags([request.tag]),
    "tag must be canonical when present",
  );
}

export function matches_exploration(
  page: PageAggregate,
  key: PageSortKey,
  scope: PageExplorationCursorScope,
): boolean {
  return (scope.namespace_query === null ||
    key.namespace_key.includes(scope.namespace_query)) &&
    (scope.page_name_query === null ||
      (key.default_rank === 1 &&
        key.page_name_key.includes(scope.page_name_query))) &&
    (scope.tag === null || page.tags.includes(scope.tag));
}
