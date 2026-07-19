import { SiteApp } from "../../components/SiteApp.tsx";
import { app_services } from "../../lib/app.ts";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { define } from "../../utils.ts";

/** `/site` is the alias for the site page; the namespace is forbidden. */
export default define.page(async function Site({ state, url }) {
  const session = state.request_context.session;
  const services = await app_services();
  const public_exploration = await services.public_exploration.present({
    namespace_query: url.searchParams.get("namespace") ?? undefined,
    page_name_query: url.searchParams.get("page") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  return (
    <SiteApp
      navigation={site_navigation_presenter.present(session, url)}
      namespace_panel={await services.namespace_panel.present(session)}
      page_management={await services.page_management_panel.present(session)}
      public_exploration={public_exploration}
    />
  );
});
