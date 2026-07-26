import type {
  SiteEditorialLink,
  SiteEditorialPage,
} from "../lib/ui/site-editorial.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import type { SiteNavigation } from "../lib/ui/site-navigation.ts";
import { SitePageHeader } from "./SiteNavigation.tsx";

export interface SiteEditorialViewProps {
  readonly navigation: SiteNavigation;
  readonly breadcrumb: SiteBreadcrumbTrail;
  readonly editorial: SiteEditorialPage;
}

/** One renderer for every editorial destination (about, demo, invite, …). */
export function SiteEditorialView(
  { navigation, breadcrumb, editorial }: SiteEditorialViewProps,
) {
  return (
    <main class={`site-app site-editorial site-editorial-${editorial.topic}`}>
      <SitePageHeader
        navigation={navigation}
        breadcrumb={breadcrumb}
        eyebrow={editorial.eyebrow}
        title={editorial.title}
        intro={editorial.intro}
      />

      <div class="site-editorial-sections">
        {editorial.sections.map((section) => (
          <section key={section.heading} class="site-editorial-section">
            <h2>{section.heading}</h2>
            {section.body.map((paragraph) => <p key={paragraph}>{paragraph}
            </p>)}
            {section.example !== undefined && (
              <p class="site-editorial-example">
                <code>{section.example}</code>
              </p>
            )}
            {section.links !== undefined && section.links.length > 0 && (
              <p class="site-editorial-links">
                {section.links.map((link) => (
                  <a key={link.href} href={link.href}>{link.label}</a>
                ))}
              </p>
            )}
          </section>
        ))}
      </div>

      {editorial.actions.length > 0 && (
        <nav class="site-editorial-actions" aria-label="Next steps">
          {editorial.actions.map((action: SiteEditorialLink) => (
            <a
              key={action.href}
              class={action.primary
                ? "site-editorial-action site-editorial-action-primary"
                : "site-editorial-action"}
              href={action.href}
            >
              {action.label}
            </a>
          ))}
        </nav>
      )}
    </main>
  );
}
