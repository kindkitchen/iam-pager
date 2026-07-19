import { SiteApp } from "../../components/SiteApp.tsx";
import { app_services } from "../../lib/app.ts";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { define } from "../../utils.ts";

/** `/site` is the alias for the site page; the namespace is forbidden. */
export default define.page(async function Site({ state, url }) {
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
