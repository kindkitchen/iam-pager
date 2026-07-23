import { ManagePagesPage } from "../../components/ManagePagesPage.tsx";
import { app_services } from "../../lib/app.ts";
import { site_breadcrumb_presenter } from "../../lib/ui/site-breadcrumb.ts";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { define } from "../../utils.ts";

/** Thin route for the creator management view. */
export default define.page(async function SiteManage({ state, url }) {
  const session = state.request_context.session;
  const services = await app_services();
  const [page_management, storage_connections] = await Promise.all([
    services.page_management_panel.present(session),
    services.storage_connection_panel.present(session),
  ]);
  return (
    <ManagePagesPage
      navigation={site_navigation_presenter.present(session, url)}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "manage" })}
      page_management={page_management}
      storage_connections={storage_connections}
    />
  );
});
