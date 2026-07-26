import type { PublicExploration } from "../lib/ui/public-exploration.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import type { SiteNavigation } from "../lib/ui/site-navigation.ts";
import { PublicExplorationPanel } from "./PublicExploration.tsx";
import { SitePageHeader } from "./SiteNavigation.tsx";

export interface ExplorePageProps {
  readonly navigation: SiteNavigation;
  readonly breadcrumb: SiteBreadcrumbTrail;
  readonly exploration: PublicExploration;
}

/** Public exploration as a dedicated site destination. */
export function ExplorePage(
  { navigation, breadcrumb, exploration }: ExplorePageProps,
) {
  return (
    <main class="site-app explore-page-shell">
      <SitePageHeader
        navigation={navigation}
        breadcrumb={breadcrumb}
        eyebrow="Public pages"
        title="Explore"
        intro="Browse public creator pages and filter them by namespace, page name, or exact tag."
      />
      <PublicExplorationPanel exploration={exploration} />
    </main>
  );
}
