import type { PublicExploration } from "../lib/ui/public-exploration.ts";
import { max_public_exploration_query_length } from "../lib/page/interfaces.ts";

export interface PublicExplorationProps {
  readonly exploration: PublicExploration;
}

/** Thin site projection over the HTTP-independent DS-EXPLORE model. */
export function PublicExplorationPanel(
  { exploration }: PublicExplorationProps,
) {
  return (
    <section
      class="public-exploration"
      aria-labelledby="public-exploration-title"
    >
      <div class="section-heading">
        <p class="eyebrow">Public pages</p>
        <h2 id="public-exploration-title">
          {exploration.is_search
            ? "Search public pages"
            : "Explore public pages"}
        </h2>
        <p>
          Browse creator-backed public pages or narrow them by namespace and
          page name. Private and guest pages never appear here.
        </p>
      </div>

      <form class="public-exploration-form" action="/site" method="GET">
        <label>
          Namespace contains
          <input
            type="search"
            name="namespace"
            value={exploration.namespace_query}
            maxLength={max_public_exploration_query_length}
            autocomplete="off"
          />
        </label>
        <label>
          Page name contains
          <input
            type="search"
            name="page"
            value={exploration.page_name_query}
            maxLength={max_public_exploration_query_length}
            autocomplete="off"
          />
        </label>
        <div class="public-exploration-form-actions">
          <button type="submit">Explore</button>
          {exploration.is_search && <a href="/site">Clear search</a>}
        </div>
      </form>

      {exploration.error !== null
        ? (
          <p class="error-message" role="alert">
            {exploration.error === "invalid_query"
              ? "Search values are too long. Shorten them and try again."
              : "That result continuation is invalid. Start the search again."}
          </p>
        )
        : exploration.pages.length === 0
        ? (
          <p class="public-exploration-empty">
            {exploration.is_search
              ? "No public creator pages match this search."
              : "No public creator pages are available yet."}
          </p>
        )
        : (
          <ul class="public-exploration-results">
            {exploration.pages.map((page) => (
              <li key={page.site_path} class="public-exploration-result">
                <div>
                  <a class="public-exploration-title" href={page.site_path}>
                    {page.label}
                  </a>
                  <p class="public-exploration-namespace">
                    Namespace: <strong>{page.namespace}</strong>
                  </p>
                </div>
                <p class="public-exploration-meta">
                  {page.content_type} · {page.size_bytes} bytes · updated{" "}
                  <time dateTime={page.updated_at.toISOString()}>
                    {page.updated_at.toISOString().slice(0, 10)}
                  </time>
                </p>
                <nav aria-label={`${page.label} links`}>
                  <a href={page.site_path}>Open site view</a>
                  <a href={page.direct_path}>Open direct content</a>
                </nav>
              </li>
            ))}
          </ul>
        )}

      {exploration.next_path !== null && (
        <a class="public-exploration-more" href={exploration.next_path}>
          More public pages
        </a>
      )}
    </section>
  );
}
