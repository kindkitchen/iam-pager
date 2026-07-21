import { ManageApiKeysPage } from "../../components/ManageApiKeysPage.tsx";
import { app_services } from "../../lib/app.ts";
import { site_breadcrumb_presenter } from "../../lib/ui/site-breadcrumb.ts";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { define } from "../../utils.ts";

/** Thin route for the owner API-key management view. */
export default define.page(async function SiteApiKeys({ state, url }) {
  const session = state.request_context.session;
  const services = await app_services();
  return (
    <ManageApiKeysPage
      navigation={site_navigation_presenter.present(session, url)}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "api_keys" })}
      api_key_panel={await services.api_key_panel.present(session)}
    />
  );
});
