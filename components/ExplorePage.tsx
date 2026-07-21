import type { PublicExploration } from "../lib/ui/public-exploration.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import type { SiteNavigation } from "../lib/ui/site-navigation.ts";
import { PublicExplorationPanel } from "./PublicExploration.tsx";
import { SiteBreadcrumb } from "./SiteBreadcrumb.tsx";
import { SiteSessionNavigation } from "./SiteApp.tsx";

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
      <header class="public-page-platform-header">
        <SiteSessionNavigation navigation={navigation} />
        <SiteBreadcrumb trail={breadcrumb} />
        <h1>Explore</h1>
      </header>
      <PublicExplorationPanel exploration={exploration} />
    </main>
  );
}
