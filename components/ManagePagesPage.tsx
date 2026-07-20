import PageManagementPanel from "../islands/PageManagementPanel.tsx";
import type { PageManagementPanel as PageManagementPanelModel } from "../lib/ui/page-management.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import type { SiteNavigation } from "../lib/ui/site-navigation.ts";
import { SiteBreadcrumb } from "./SiteBreadcrumb.tsx";
import { SiteSessionNavigation } from "./SiteApp.tsx";

export interface ManagePagesPageProps {
  readonly navigation: SiteNavigation;
  readonly breadcrumb: SiteBreadcrumbTrail;
  readonly page_management: PageManagementPanelModel;
}

/**
 * Prototype navigation split: creator page management as its own navigable
 * page instead of one panel stacked on the landing.
 */
export function ManagePagesPage(
  { navigation, breadcrumb, page_management }: ManagePagesPageProps,
) {
  return (
    <main class="site-app manage-pages-shell">
      <header class="public-page-platform-header">
        <SiteSessionNavigation navigation={navigation} />
        <SiteBreadcrumb trail={breadcrumb} />
        <h1>Manage pages</h1>
      </header>

      {page_management.kind === "creator"
        ? (
          <PageManagementPanel
            csrf_token={page_management.csrf_token}
            initial_pages={page_management.pages}
            initial_next_cursor={page_management.next_cursor}
          />
        )
        : (
          <section class="manage-pages-guest">
            <p class="eyebrow">Creators only</p>
            <h2>Sign in to manage pages</h2>
            <p>
              Page management is available to signed-in creators. Return to the
              {" "}
              <a href="/site">site home</a> to publish a page.
            </p>
          </section>
        )}
    </main>
  );
}
