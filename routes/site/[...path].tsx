import { SiteApp } from "../../components/SiteApp.tsx";
import { app_services } from "../../lib/app.ts";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { define } from "../../utils.ts";

/**
 * Every `/site/*` path serves the SPA shell; client-side routing owns the
 * remainder of the path (001.draft site routing).
 */
export default define.page(async function SitePath({ state, url }) {
  const session = state.request_context.session;
  return (
    <SiteApp
      navigation={site_navigation_presenter.present(session, url)}
      namespace_panel={await (await app_services()).namespace_panel.present(
        session,
      )}
    />
  );
});
