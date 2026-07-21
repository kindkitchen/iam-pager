import { page } from "fresh";
import { SiteApp } from "../components/SiteApp.tsx";
import { app_services } from "../lib/app.ts";
import { site_breadcrumb_presenter } from "../lib/ui/site-breadcrumb.ts";
import { legacy_exploration_redirect_location } from "../lib/ui/public-exploration.ts";
import { site_navigation_presenter } from "../lib/ui/site-navigation.ts";
import { define } from "../utils.ts";

/** Home renders publishing; legacy exploration queries redirect canonically. */
export const handler = define.handlers({
  async GET(ctx) {
    const exploration_redirect = legacy_exploration_redirect_location(ctx.url);
    if (exploration_redirect !== null) {
      return new Response(null, {
        status: 308,
        headers: { location: exploration_redirect },
      });
    }
    const session = ctx.state.request_context.session;
    const services = await app_services();
    return page({
      navigation: site_navigation_presenter.present(session, ctx.url),
      breadcrumb: site_breadcrumb_presenter.present({ kind: "home" }),
      namespace_panel: await services.namespace_panel.present(session),
      page_management: await services.page_management_panel.present(session),
    });
  },
});

/** The raw domain root serves the site itself, not raw content. */
export default define.page<typeof handler>(function Home({ data }) {
  return <SiteApp {...data} />;
});
