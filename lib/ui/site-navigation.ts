import { normalize_authentication_return_to } from "../auth/model.ts";
import type { Session } from "../session/model.ts";

export interface SiteNavigationFormField {
  readonly name: string;
  readonly value: string;
}

export interface SiteNavigationDestination {
  readonly href: string;
  readonly label: string;
  readonly current: boolean;
}

export type SiteNavigationAction =
  | {
    readonly kind: "link";
    readonly href: string;
    readonly label: string;
  }
  | {
    readonly kind: "form";
    readonly action: string;
    readonly method: "post";
    readonly fields: readonly SiteNavigationFormField[];
    readonly label: string;
  };

export interface SiteNavigation {
  readonly destinations: readonly SiteNavigationDestination[];
  readonly session_label: string;
  readonly action: SiteNavigationAction;
}

export interface SiteNavigationPresenter {
  present(session: Session, request_url: URL): SiteNavigation;
}

/** Keeps site destinations and trusted session actions outside components. */
export class SessionSiteNavigationPresenter implements SiteNavigationPresenter {
  present(session: Session, request_url: URL): SiteNavigation {
    const navigation = {
      destinations: site_destinations(
        request_url.pathname,
        session.kind === "authenticated",
      ),
      session_label: session.kind === "authenticated"
        ? "Signed in"
        : "Guest session",
    };
    if (session.kind === "guest") {
      const requested_return = `${request_url.pathname}${request_url.search}`;
      const return_to = normalize_authentication_return_to(requested_return) ??
        "/";
      const query = new URLSearchParams({ return_to });
      return {
        ...navigation,
        action: {
          kind: "link",
          href: `/auth/google/start?${query}`,
          label: "Sign in with Google",
        },
      };
    }

    return {
      ...navigation,
      action: {
        kind: "form",
        action: "/auth/logout",
        method: "post",
        fields: [{ name: "csrf_token", value: session.csrf_token }],
        label: "Sign out",
      },
    };
  }
}

function site_destinations(
  pathname: string,
  authenticated: boolean,
): SiteNavigationDestination[] {
  const destinations: SiteNavigationDestination[] = [
    {
      href: "/site",
      label: "Home",
      current: pathname === "/" || pathname === "/site" ||
        pathname === "/site/",
    },
    {
      href: "/site/explore",
      label: "Explore",
      current: pathname === "/site/explore" ||
        pathname === "/site/explore/",
    },
  ];
  if (authenticated) {
    destinations.push({
      href: "/site/manage",
      label: "Manage",
      current: pathname === "/site/manage" || pathname === "/site/manage/",
    });
  }
  return destinations;
}

export const site_navigation_presenter: SiteNavigationPresenter =
  new SessionSiteNavigationPresenter();
