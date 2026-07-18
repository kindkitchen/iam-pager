import { SiteApp } from "../components/SiteApp.tsx";
import { site_navigation_presenter } from "../lib/ui/site-navigation.ts";
import { define } from "../utils.ts";

/** The raw domain root serves the site itself, not raw content. */
export default define.page(function Home({ state, url }) {
  return (
    <SiteApp
      navigation={site_navigation_presenter.present(
        state.request_context.session,
        url,
      )}
    />
  );
});
