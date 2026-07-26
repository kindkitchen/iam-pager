import { normalize_authentication_return_to } from "../auth/model.ts";
import type { Session } from "../session/model.ts";
import {
  is_current_destination,
  site_map_reader,
  type SiteMapReader,
} from "./site-map.ts";

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
  readonly #site_map: SiteMapReader;

  constructor(site_map: SiteMapReader = site_map_reader) {
    this.#site_map = site_map;
  }

  present(session: Session, request_url: URL): SiteNavigation {
    const navigation = {
      destinations: this.#site_map.visible(session)
        .filter((destination) => destination.in_navigation)
        .map((destination) => ({
          href: destination.href,
          label: destination.label,
          current: is_current_destination(destination, request_url.pathname),
        })),
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

export const site_navigation_presenter: SiteNavigationPresenter =
  new SessionSiteNavigationPresenter();
