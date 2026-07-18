import { normalize_authentication_return_to } from "../auth/model.ts";
import type { Session } from "../session/model.ts";

export interface SiteNavigationFormField {
  readonly name: string;
  readonly value: string;
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

/** Complete server-owned model rendered by the site session navigation. */
export interface SiteNavigation {
  readonly session_label: string;
  readonly action: SiteNavigationAction;
}

export interface SiteNavigationPresenter {
  present(session: Session, request_url: URL): SiteNavigation;
}

/** Keeps session decisions and trusted action inputs outside UI components. */
export class SessionSiteNavigationPresenter implements SiteNavigationPresenter {
  present(session: Session, request_url: URL): SiteNavigation {
    if (session.kind === "guest") {
      const requested_return = `${request_url.pathname}${request_url.search}`;
      const return_to = normalize_authentication_return_to(requested_return) ??
        "/";
      const query = new URLSearchParams({ return_to });
      return {
        session_label: "Guest session",
        action: {
          kind: "link",
          href: `/auth/google/start?${query}`,
          label: "Sign in with Google",
        },
      };
    }

    return {
      session_label: "Signed in",
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
