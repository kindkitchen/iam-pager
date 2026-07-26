import type {
  SiteNavigation,
  SiteNavigationAction,
} from "../lib/ui/site-navigation.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import { SiteBreadcrumb } from "./SiteBreadcrumb.tsx";

/** Renders an already-authorized server model without inspecting the session. */
export function SiteSessionNavigation(
  { navigation }: { readonly navigation: SiteNavigation },
) {
  return (
    <nav class="site-navigation" aria-label="Site">
      <div class="site-navigation-destinations">
        {navigation.destinations.map((destination) => (
          <a
            class="site-navigation-destination"
            href={destination.href}
            aria-current={destination.current ? "page" : undefined}
          >
            {destination.label}
          </a>
        ))}
      </div>
      <span class="site-session-state">{navigation.session_label}</span>
      <SiteNavigationActionControl action={navigation.action} />
    </nav>
  );
}

export interface SitePageHeaderProps {
  readonly navigation: SiteNavigation;
  readonly breadcrumb?: SiteBreadcrumbTrail;
  readonly title: string;
  readonly eyebrow?: string;
  readonly intro?: string;
}

/** Shared header for every site destination: navigation, trail, and title. */
export function SitePageHeader(
  { navigation, breadcrumb, title, eyebrow, intro }: SitePageHeaderProps,
) {
  return (
    <header class="site-page-header">
      <SiteSessionNavigation navigation={navigation} />
      {breadcrumb && <SiteBreadcrumb trail={breadcrumb} />}
      {eyebrow && <p class="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {intro && <p class="hero-copy">{intro}</p>}
    </header>
  );
}

function SiteNavigationActionControl(
  { action }: { readonly action: SiteNavigationAction },
) {
  if (action.kind === "link") {
    return (
      <a class="site-navigation-action" href={action.href}>
        {action.label}
      </a>
    );
  }

  return (
    <form
      class="site-navigation-form"
      action={action.action}
      method={action.method}
    >
      {action.fields.map((field) => (
        <input
          key={field.name}
          type="hidden"
          name={field.name}
          value={field.value}
          autocomplete="off"
        />
      ))}
      <button class="site-navigation-action" type="submit">
        {action.label}
      </button>
    </form>
  );
}
