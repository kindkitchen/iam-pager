import { SiteEditorialView } from "../../components/SiteEditorial.tsx";
import { site_breadcrumb_presenter } from "../../lib/ui/site-breadcrumb.ts";
import { site_editorial_presenter } from "../../lib/ui/site-editorial.ts";
import { site_navigation_presenter } from "../../lib/ui/site-navigation.ts";
import { define } from "../../utils.ts";

/** Guided walkthrough from an empty path to a shared URL. */
export default define.page(function SiteDemo({ state, url }) {
  const session = state.request_context.session;
  return (
    <SiteEditorialView
      navigation={site_navigation_presenter.present(session, url)}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "demo" })}
      editorial={site_editorial_presenter.present("demo", session)}
    />
  );
});
