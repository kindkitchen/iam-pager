import { SiteApp } from "../../components/SiteApp.tsx";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { define } from "../../utils.ts";

/**
 * Every `/site/*` path serves the SPA shell; client-side routing owns the
 * remainder of the path (001.draft site routing).
 */
export default define.page(function SitePath({ state, url }) {
  return (
    <SiteApp
      navigation={site_navigation_presenter.present(
        state.request_context.session,
        url,
      )}
    />
  );
});
