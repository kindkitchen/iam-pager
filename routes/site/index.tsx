import { SiteApp } from "../../components/SiteApp.tsx";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { define } from "../../utils.ts";

/** `/site` is the alias for the site page; the namespace is forbidden. */
export default define.page(function Site({ state, url }) {
  return (
    <SiteApp
      navigation={site_navigation_presenter.present(
        state.request_context.session,
        url,
      )}
    />
  );
});
