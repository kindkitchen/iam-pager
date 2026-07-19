import { SiteApp } from "../components/SiteApp.tsx";
import { app_services } from "../lib/app.ts";
import { site_navigation_presenter } from "../lib/ui/site-navigation.ts";
import { define } from "../utils.ts";

/** The raw domain root serves the site itself, not raw content. */
export default define.page(async function Home({ state, url }) {
  const session = state.request_context.session;
  const services = await app_services();
  return (
    <SiteApp
      navigation={site_navigation_presenter.present(session, url)}
      namespace_panel={await services.namespace_panel.present(session)}
      page_management={await services.page_management_panel.present(session)}
    />
  );
});
