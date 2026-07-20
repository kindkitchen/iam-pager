import type { PublicPageView } from "../lib/ui/public-page-view.ts";
import type { SiteNavigation } from "../lib/ui/site-navigation.ts";
import { SiteSessionNavigation } from "./SiteApp.tsx";

export interface PublicPageViewProps {
  readonly navigation: SiteNavigation;
  readonly view: PublicPageView;
}

/** Thin Fresh projection over the web-independent DS-VIEW presenter model. */
export function PublicPageViewPage(
  { navigation, view }: PublicPageViewProps,
) {
  if (view.kind === "missing") {
    return (
      <main class="site-app public-page-shell">
        <header class="public-page-platform-header">
          <SiteSessionNavigation navigation={navigation} />
          <a class="public-page-home" href="/site">iam-pager</a>
        </header>
        <section class="public-page-missing">
          <p class="eyebrow">Page unavailable</p>
          <h1>That page was not found</h1>
          <p>The path is missing or is not available to visitors.</p>
        </section>
      </main>
    );
  }

  const title = view.page.locator.page_name ?? "Default page";
  return (
    <main class="site-app public-page-shell">
      <header class="public-page-platform-header">
        <SiteSessionNavigation navigation={navigation} />
        <div>
          <a class="public-page-home" href="/site">iam-pager</a>
          <span class="public-page-platform-label">Site view</span>
        </div>
        <h1>{title}</h1>
        <p>
          Public content at <strong>{view.page.locator.namespace}</strong>
        </p>
        <nav class="public-page-actions" aria-label="Page actions">
          <a href={view.page.endpoints.canonical.path}>
            Open canonical {view.page.endpoints.canonical.delivery_profile}
          </a>
          {view.page.endpoints.alternates.map((endpoint) => (
            <a key={endpoint.path} href={endpoint.path}>
              Open alternate {endpoint.delivery_profile}: {endpoint.path}
            </a>
          ))}
          {view.default_page !== null && (
            <a href={view.default_page.site_path}>Creator default page</a>
          )}
        </nav>
      </header>

      <section class="public-content-frame" aria-label="Creator content">
        <p class="public-content-label">Creator content</p>
        {view.preview.kind === "html"
          ? (
            <iframe
              title={`${title} creator content`}
              sandbox=""
              referrerpolicy="no-referrer"
              srcdoc={view.preview.document}
            />
          )
          : (
            <div class="public-content-fallback">
              <h2>Preview unavailable</h2>
              <p>
                This content is {view.preview.media_type}{" "}
                ({view.preview.size_bytes}{" "}
                bytes). Open the direct content to view or download it.
              </p>
              <a href={view.page.endpoints.canonical.path}>
                Open canonical {view.page.endpoints.canonical.delivery_profile}
              </a>
            </div>
          )}
      </section>

      {view.other_pages.length > 0 && (
        <aside class="public-page-related">
          <h2>Other public pages</h2>
          <ul>
            {view.other_pages.map((page) => (
              <li key={page.site_path}>
                <a href={page.site_path}>{page.label}</a>
              </li>
            ))}
          </ul>
          {view.has_more_public_pages && (
            <p>More public pages are available from this creator.</p>
          )}
        </aside>
      )}
    </main>
  );
}
