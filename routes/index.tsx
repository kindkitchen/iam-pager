import { page } from "fresh";
import { SiteHome } from "../components/SiteHome.tsx";
import { site_breadcrumb_presenter } from "../lib/ui/site-breadcrumb.ts";
import { legacy_exploration_redirect_location } from "../lib/ui/public-exploration.ts";
import { site_home_presenter } from "../lib/ui/site-home.ts";
import { site_navigation_presenter } from "../lib/ui/site-navigation.ts";
import { define } from "../utils.ts";

/** Home is the navigation hub; legacy exploration queries redirect canonically. */
export const handler = define.handlers({
  GET(ctx) {
    const exploration_redirect = legacy_exploration_redirect_location(ctx.url);
    if (exploration_redirect !== null) {
      return new Response(null, {
        status: 308,
        headers: { location: exploration_redirect },
      });
    }
    const session = ctx.state.request_context.session;
    return page({
      navigation: site_navigation_presenter.present(session, ctx.url),
      breadcrumb: site_breadcrumb_presenter.present({ kind: "home" }),
      home: site_home_presenter.present(session),
    });
  },
});

/** The raw domain root serves the site itself, not raw content. */
export default define.page<typeof handler>(function Home({ data }) {
  return <SiteHome {...data} />;
});
