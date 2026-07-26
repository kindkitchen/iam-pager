import PagePublishForm from "../islands/PagePublishForm.tsx";
import NamespaceReservationPanel from "../islands/NamespaceReservationPanel.tsx";
import type { NamespacePanel } from "../lib/ui/namespace-panel.ts";
import { page_publish_authorization } from "../lib/ui/page-publish.ts";
import { FourWordRandomNameGenerator } from "../lib/random-name.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import type { SiteNavigation } from "../lib/ui/site-navigation.ts";
import type { StorageConnectionPanel } from "../lib/ui/storage-connections.ts";
import { SitePageHeader } from "./SiteNavigation.tsx";

export interface PublishPageProps {
  readonly navigation: SiteNavigation;
  readonly breadcrumb: SiteBreadcrumbTrail;
  readonly namespace_panel: NamespacePanel;
  readonly storage_connections: StorageConnectionPanel;
}

/** Page generation as a dedicated, full-width destination. */
export function PublishPage(
  {
    navigation,
    breadcrumb,
    namespace_panel,
    storage_connections,
  }: PublishPageProps,
) {
  const initial_namespace = new FourWordRandomNameGenerator().generate();
  const is_creator = namespace_panel.kind === "creator";
  return (
    <main class="site-app publish-page-shell">
      <SitePageHeader
        navigation={navigation}
        breadcrumb={breadcrumb}
        eyebrow={is_creator ? "Creator publishing" : "Guest publishing"}
        title="Publish a page"
        intro="Choose the paths first, then the content. Every path serves the same logical page; aliases never copy content."
      />

      {namespace_panel.kind === "creator" && (
        <NamespaceReservationPanel
          csrf_token={namespace_panel.csrf_token}
          initial_reservations={namespace_panel.reservations}
        />
      )}

      <PagePublishForm
        initial_namespace={initial_namespace}
        authorization={page_publish_authorization(namespace_panel)}
        storage_options={storage_connections.kind === "creator"
          ? storage_connections.writable_options
          : []}
      />

      <aside class="guest-notice">
        <h2>
          {is_creator
            ? "Unreserved pages remain unprotected"
            : "Guest pages are unprotected"}
        </h2>
        <p>
          Publishing at an existing unreserved path replaces it, and those pages
          do not appear in search or browsing. Reserve the namespace first to
          protect it from guest and cross-creator writes.
        </p>
        {!is_creator && (
          <p>
            <a href="/site/invite">What signing in adds</a>
          </p>
        )}
      </aside>
    </main>
  );
}
