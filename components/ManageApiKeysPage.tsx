import ApiKeyPanel from "../islands/ApiKeyPanel.tsx";
import type { ApiKeyPanel as ApiKeyPanelModel } from "../lib/ui/api-key-panel.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import type { SiteNavigation } from "../lib/ui/site-navigation.ts";
import { SiteBreadcrumb } from "./SiteBreadcrumb.tsx";
import { SiteSessionNavigation } from "./SiteApp.tsx";

export interface ManageApiKeysPageProps {
  readonly navigation: SiteNavigation;
  readonly breadcrumb: SiteBreadcrumbTrail;
  readonly api_key_panel: ApiKeyPanelModel;
}

/** Owner API-key management as a dedicated site view. */
export function ManageApiKeysPage(
  { navigation, breadcrumb, api_key_panel }: ManageApiKeysPageProps,
) {
  return (
    <main class="site-app manage-api-keys-shell">
      <header class="public-page-platform-header">
        <SiteSessionNavigation navigation={navigation} />
        <SiteBreadcrumb trail={breadcrumb} />
        <h1>API keys</h1>
      </header>

      {api_key_panel.kind === "creator"
        ? (
          <ApiKeyPanel
            csrf_token={api_key_panel.csrf_token}
            initial_api_keys={api_key_panel.api_keys}
          />
        )
        : (
          <section class="manage-api-keys-guest">
            <p class="eyebrow">Creators only</p>
            <h2>Sign in to manage API keys</h2>
            <p>
              API keys are available to signed-in creators. Return to the{" "}
              <a href="/site">site home</a> to sign in.
            </p>
          </section>
        )}
    </main>
  );
}
