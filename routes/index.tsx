import { SiteApp } from "../components/SiteApp.tsx";
import { app_services } from "../lib/app.ts";
import { site_navigation_presenter } from "../lib/ui/site-navigation.ts";
import { define } from "../utils.ts";

/** The raw domain root serves the site itself, not raw content. */
export default define.page(async function Home({ state, url }) {
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
