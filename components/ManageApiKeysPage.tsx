import ApiKeyPanel from "../islands/ApiKeyPanel.tsx";
import type { ApiKeyPanel as ApiKeyPanelModel } from "../lib/ui/api-key-panel.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import type { SiteNavigation } from "../lib/ui/site-navigation.ts";
import { SitePageHeader } from "./SiteNavigation.tsx";

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
      <SitePageHeader
        navigation={navigation}
        breadcrumb={breadcrumb}
        eyebrow="Automation"
        title="API keys"
        intro="Issue and revoke keys that drive the same API this site uses."
      />

      <p class="manage-api-keys-skill">
        Handing a key to an AI agent? Give it the{" "}
        <a href="/site/skill">agent skill</a>{" "}
        as well, and lock the pages it must not touch with “Block API writes” in
        {" "}
        <a href="/site/manage">page management</a>.
      </p>

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
              API keys are available to signed-in creators. Read{" "}
              <a href="/site/invite">what signing in adds</a>, or return to the
              {" "}
              <a href="/site">site home</a>.
            </p>
          </section>
        )}
    </main>
  );
}
