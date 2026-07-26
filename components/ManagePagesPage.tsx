import NamespaceReservationPanel from "../islands/NamespaceReservationPanel.tsx";
import PageManagementPanel from "../islands/PageManagementPanel.tsx";
import type { NamespacePanel } from "../lib/ui/namespace-panel.ts";
import type { PageManagementPanel as PageManagementPanelModel } from "../lib/ui/page-management.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import type { SiteNavigation } from "../lib/ui/site-navigation.ts";
import { SitePageHeader } from "./SiteNavigation.tsx";
import type { StorageConnectionPanel as StorageConnectionPanelModel } from "../lib/ui/storage-connections.ts";
import { StorageConnectionsPanel } from "./StorageConnectionsPanel.tsx";

export interface ManagePagesPageProps {
  readonly navigation: SiteNavigation;
  readonly breadcrumb: SiteBreadcrumbTrail;
  readonly namespace_panel: NamespacePanel;
  readonly page_management: PageManagementPanelModel;
  readonly storage_connections: StorageConnectionPanelModel;
}

/** Creator page management as a dedicated site view. */
export function ManagePagesPage(
  {
    navigation,
    breadcrumb,
    namespace_panel,
    page_management,
    storage_connections,
  }: ManagePagesPageProps,
) {
  return (
    <main class="site-app manage-pages-shell">
      <SitePageHeader
        navigation={navigation}
        breadcrumb={breadcrumb}
        eyebrow="Your pages"
        title="Manage pages"
        intro="Namespaces, storage connections, and every page you published."
      />

      {page_management.kind === "creator"
        ? (
          <>
            {namespace_panel.kind === "creator" && (
              <NamespaceReservationPanel
                csrf_token={namespace_panel.csrf_token}
                initial_reservations={namespace_panel.reservations}
              />
            )}
            <StorageConnectionsPanel panel={storage_connections} />
            <PageManagementPanel
              csrf_token={page_management.csrf_token}
              owned_namespaces={page_management.owned_namespaces}
              storage_options={storage_connections.kind === "creator"
                ? storage_connections.writable_options
                : []}
              initial_pages={page_management.pages}
              initial_next_cursor={page_management.next_cursor}
            />
          </>
        )
        : (
          <section class="manage-pages-guest">
            <p class="eyebrow">Creators only</p>
            <h2>Sign in to manage pages</h2>
            <p>
              Page management is available to signed-in creators. Anyone can
              still <a href="/site/publish">publish a page</a>, or read{" "}
              <a href="/site/invite">what signing in adds</a>.
            </p>
          </section>
        )}
    </main>
  );
}
