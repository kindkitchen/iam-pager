/**
 * Logical position within the site, independent of any URL. The breadcrumb is
 * derived from this location, so the address bar is a projection — not the
 * source — and another front-end can reuse the same trail.
 */
export type SiteLocation =
  | { readonly kind: "home" }
  | { readonly kind: "publish" }
  | { readonly kind: "explore" }
  | { readonly kind: "manage" }
  | { readonly kind: "api_keys" }
  | { readonly kind: "about" }
  | { readonly kind: "demo" }
  | { readonly kind: "invite" }
  | { readonly kind: "public_page"; readonly title: string };

/** One breadcrumb step. The current (last) step carries no link. */
export interface SiteBreadcrumb {
  readonly label: string;
  readonly href?: string;
}

/** Complete ordered trail from the site root to the current location. */
export interface SiteBreadcrumbTrail {
  readonly steps: readonly SiteBreadcrumb[];
}

/** Builds a complete trail for a logical location. */
export interface SiteBreadcrumbPresenter {
  present(location: SiteLocation): SiteBreadcrumbTrail;
}

/** Canonical site root, used as the first step of every non-home trail. */
export const site_home_href = "/site";

/** Maps each logical location to its trail; no URL parsing, no UI. */
export class SiteLocationBreadcrumbPresenter
  implements SiteBreadcrumbPresenter {
  present(location: SiteLocation): SiteBreadcrumbTrail {
    switch (location.kind) {
      case "home":
        return { steps: [{ label: "Home" }] };
      case "publish":
        return branch("Publish a page");
      case "explore":
        return branch("Explore");
      case "manage":
        return branch("Manage pages");
      case "api_keys":
        return branch("API keys");
      case "about":
        return branch("About");
      case "demo":
        return branch("Demo");
      case "invite":
        return branch("Invitation");
      case "public_page":
        return {
          steps: [
            { label: "Home", href: site_home_href },
            { label: location.title },
          ],
        };
    }
  }
}

/** One-level trail below the site root. */
function branch(label: string): SiteBreadcrumbTrail {
  return { steps: [{ label: "Home", href: site_home_href }, { label }] };
}

export const site_breadcrumb_presenter: SiteBreadcrumbPresenter =
  new SiteLocationBreadcrumbPresenter();
