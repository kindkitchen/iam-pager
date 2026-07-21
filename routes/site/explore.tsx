import { ExplorePage } from "../../components/ExplorePage.tsx";
import { app_services } from "../../lib/app.ts";
import { site_breadcrumb_presenter } from "../../lib/ui/site-breadcrumb.ts";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { define } from "../../utils.ts";

/** Dedicated public exploration destination. */
export default define.page(async function SiteExplore({ state, url }) {
  const services = await app_services();
  return (
    <ExplorePage
      navigation={site_navigation_presenter.present(
        state.request_context.session,
        url,
      )}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "explore" })}
      exploration={await services.public_exploration.present({
        namespace_query: url.searchParams.get("namespace") ?? undefined,
        page_name_query: url.searchParams.get("page") ?? undefined,
        tag: url.searchParams.get("tag") ?? undefined,
        cursor: url.searchParams.get("cursor") ?? undefined,
      })}
    />
  );
});
