import { PublishPage } from "../../components/PublishPage.tsx";
import { app_services } from "../../lib/app.ts";
import { site_breadcrumb_presenter } from "../../lib/ui/site-breadcrumb.ts";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { define } from "../../utils.ts";

/** Dedicated page-generation destination, separate from the navigation hub. */
export default define.page(async function SitePublish({ state, url }) {
  const session = state.request_context.session;
  const services = await app_services();
  const [namespace_panel, storage_connections] = await Promise.all([
    services.namespace_panel.present(session),
    services.storage_connection_panel.present(session),
  ]);
  return (
    <PublishPage
      navigation={site_navigation_presenter.present(session, url)}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "publish" })}
      namespace_panel={namespace_panel}
      storage_connections={storage_connections}
    />
  );
});
