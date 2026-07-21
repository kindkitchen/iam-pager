import { ManagePagesPage } from "../../components/ManagePagesPage.tsx";
import { app_services } from "../../lib/app.ts";
import { site_breadcrumb_presenter } from "../../lib/ui/site-breadcrumb.ts";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { define } from "../../utils.ts";

/** Thin route for the creator management view. */
export default define.page(async function SiteManage({ state, url }) {
  const session = state.request_context.session;
  const services = await app_services();
  return (
    <ManagePagesPage
      navigation={site_navigation_presenter.present(session, url)}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "manage" })}
      page_management={await services.page_management_panel.present(session)}
    />
  );
});
