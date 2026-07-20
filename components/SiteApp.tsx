import PagePublishForm from "../islands/PagePublishForm.tsx";
import NamespaceReservationPanel from "../islands/NamespaceReservationPanel.tsx";
import { PublicExplorationPanel } from "./PublicExploration.tsx";
import PageManagementPanel from "../islands/PageManagementPanel.tsx";
import type { NamespacePanel } from "../lib/ui/namespace-panel.ts";
import type { PageManagementPanel as PageManagementPanelModel } from "../lib/ui/page-management.ts";
import type { PublicExploration } from "../lib/ui/public-exploration.ts";
import { page_publish_authorization } from "../lib/ui/page-publish.ts";
import { FourWordRandomNameGenerator } from "../lib/ui/random-name.ts";
import type {
  SiteNavigation,
  SiteNavigationAction,
} from "../lib/ui/site-navigation.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import { SiteBreadcrumb } from "./SiteBreadcrumb.tsx";

export interface SiteAppProps {
  readonly navigation: SiteNavigation;
  readonly breadcrumb?: SiteBreadcrumbTrail;
  readonly namespace_panel: NamespacePanel;
  readonly page_management: PageManagementPanelModel;
  readonly public_exploration: PublicExploration;
}

/** Site shell served at `/` and `/site/*`; raw delivery stays separate. */
export function SiteApp(
  {
    navigation,
    breadcrumb,
    namespace_panel,
    page_management,
    public_exploration,
  }: SiteAppProps,
) {
  const initial_namespace = new FourWordRandomNameGenerator().generate();
  return (
    <main class="site-app">
      <header class="hero">
        <SiteSessionNavigation navigation={navigation} />
        {breadcrumb && <SiteBreadcrumb trail={breadcrumb} />}
        <p class="eyebrow">Content at a URL</p>
        <h1>iam-pager</h1>
        <p class="hero-copy">
          Associate Markdown with a path of your choosing, then share the direct
          page without this site's wrapper.
        </p>
      </header>

      <PublicExplorationPanel exploration={public_exploration} />

      {namespace_panel.kind === "creator" && (
        <NamespaceReservationPanel
          csrf_token={namespace_panel.csrf_token}
          initial_reservations={namespace_panel.reservations}
        />
      )}

      {page_management.kind === "creator" && (
        <p class="manage-page-link">
          <a href="/site/manage">Open the full-page manager</a>
        </p>
      )}

      {page_management.kind === "creator" && (
        <PageManagementPanel
          csrf_token={page_management.csrf_token}
          initial_pages={page_management.pages}
          initial_next_cursor={page_management.next_cursor}
        />
      )}

      <PagePublishForm
        initial_namespace={initial_namespace}
        authorization={page_publish_authorization(namespace_panel)}
      />

      <aside class="guest-notice">
        <h2>
          {namespace_panel.kind === "creator"
            ? "Unreserved pages remain unprotected"
            : "Guest pages are unprotected"}
        </h2>
        <p>
          Publishing at an existing unreserved path replaces it, and those pages
          do not appear in search or browsing. Reserve the namespace first to
          protect it from guest and cross-creator writes.
        </p>
      </aside>
    </main>
  );
}

/** Renders an already-authorized server model without inspecting the session. */
export function SiteSessionNavigation(
  { navigation }: { readonly navigation: SiteNavigation },
) {
  return (
    <nav class="site-navigation" aria-label="Session">
      <span class="site-session-state">{navigation.session_label}</span>
      <SiteNavigationAction action={navigation.action} />
    </nav>
  );
}

function SiteNavigationAction(
  { action }: { readonly action: SiteNavigationAction },
) {
  if (action.kind === "link") {
    return (
      <a class="site-navigation-action" href={action.href}>
        {action.label}
      </a>
    );
  }

  return (
    <form
      class="site-navigation-form"
      action={action.action}
      method={action.method}
    >
      {action.fields.map((field) => (
        <input
          key={field.name}
          type="hidden"
          name={field.name}
          value={field.value}
          autocomplete="off"
        />
      ))}
      <button class="site-navigation-action" type="submit">
        {action.label}
      </button>
    </form>
  );
}
