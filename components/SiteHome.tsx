import type { SiteHome as SiteHomeModel } from "../lib/ui/site-home.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import type { SiteNavigation } from "../lib/ui/site-navigation.ts";
import { SitePageHeader } from "./SiteNavigation.tsx";

export interface SiteHomeProps {
  readonly navigation: SiteNavigation;
  readonly breadcrumb?: SiteBreadcrumbTrail;
  readonly home: SiteHomeModel;
}

/**
 * The home page is the navigation hub: it renders the site map produced by the
 * presenter and owns no publishing or management state of its own.
 */
export function SiteHome({ navigation, breadcrumb, home }: SiteHomeProps) {
  return (
    <main class="site-app site-hub-shell">
      <SitePageHeader
        navigation={navigation}
        breadcrumb={breadcrumb}
        eyebrow={home.eyebrow}
        title={home.headline}
        intro={home.intro}
      />

      <div class="site-hub">
        {home.sections.map((section) => (
          <section
            key={section.group}
            class="site-hub-section"
            aria-labelledby={`hub-${section.group}`}
          >
            <div class="site-hub-section-heading">
              <h2 id={`hub-${section.group}`}>{section.title}</h2>
              <p>{section.description}</p>
            </div>
            <ul class="site-hub-cards">
              {section.entries.map((entry) => (
                <li key={entry.id}>
                  <a
                    class={`site-hub-card${
                      entry.primary ? " site-hub-card-primary" : ""
                    }`}
                    href={entry.href}
                  >
                    <span class="site-hub-card-label">{entry.label}</span>
                    <span class="site-hub-card-summary">{entry.summary}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
