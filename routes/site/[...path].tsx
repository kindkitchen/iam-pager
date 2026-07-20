import { page } from "fresh";
import { PublicPageViewPage } from "../../components/PublicPageView.tsx";
import { app_services } from "../../lib/app.ts";
import type { PublicPageView } from "../../lib/ui/public-page-view.ts";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { site_breadcrumb_presenter } from "../../lib/ui/site-breadcrumb.ts";
import { define } from "../../utils.ts";

/** Resolve `/site/<locator>` through the same locator and public-view logic. */
export const handler = define.handlers({
  async GET(ctx) {
    const services = await app_services();
    const locator_path = ctx.url.pathname.slice("/site".length);
    const resolution = services.engine.resolve(locator_path);
    const view: PublicPageView = resolution.ok
      ? await services.public_page_view.present(resolution.locator)
      : { kind: "missing" };
    const title = view.kind === "page"
      ? (view.page.locator.page_name ?? "Default page")
      : "Page unavailable";
    return page({
      navigation: site_navigation_presenter.present(
        ctx.state.request_context.session,
        ctx.url,
      ),
      breadcrumb: site_breadcrumb_presenter.present({
        kind: "public_page",
        title,
      }),
      view,
    }, {
      status: view.kind === "missing" ? 404 : 200,
      headers: { "cache-control": "private, no-store" },
    });
  },
});

export default define.page<typeof handler>(function SitePublicPage({ data }) {
  return (
    <PublicPageViewPage
      navigation={data.navigation}
      breadcrumb={data.breadcrumb}
      view={data.view}
    />
  );
});
