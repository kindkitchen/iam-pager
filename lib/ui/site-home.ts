import type { Session } from "../session/model.ts";
import {
  site_map_reader,
  type SiteDestinationDefinition,
  type SiteDestinationGroup,
  type SiteDestinationId,
  type SiteMapReader,
} from "./site-map.ts";

/** One hub card; already filtered for this session. */
export interface SiteHubEntry {
  readonly id: SiteDestinationId;
  readonly href: string;
  readonly label: string;
  readonly summary: string;
  /** Marks the single most useful next step of its group. */
  readonly primary: boolean;
}

/** One titled block of hub cards. */
export interface SiteHubSection {
  readonly group: SiteDestinationGroup;
  readonly title: string;
  readonly description: string;
  readonly entries: readonly SiteHubEntry[];
}

/** Complete server-owned model of the home hub. */
export interface SiteHome {
  readonly eyebrow: string;
  readonly headline: string;
  readonly intro: string;
  readonly sections: readonly SiteHubSection[];
}

export interface SiteHomePresenter {
  present(session: Session): SiteHome;
}

interface GroupCopy {
  readonly title: string;
  readonly description: string;
  readonly primary: SiteDestinationId;
}

const group_order: readonly SiteDestinationGroup[] = [
  "create",
  "discover",
  "learn",
  "account",
];

const group_copy: Readonly<Record<SiteDestinationGroup, GroupCopy>> = {
  create: {
    title: "Publish",
    description: "Turn content into a URL, then keep that URL under control.",
    primary: "publish",
  },
  discover: {
    title: "Discover",
    description: "See what other creators made public.",
    primary: "explore",
  },
  learn: {
    title: "Learn",
    description: "What the platform does, shown before it is explained.",
    primary: "demo",
  },
  account: {
    title: "Account",
    description: "Access that belongs to you rather than to a page.",
    primary: "invite",
  },
};

/**
 * Builds the hub from the site map. The hub is a projection of the map, so a
 * destination added to the map appears here without touching any component.
 */
export class SiteMapHomePresenter implements SiteHomePresenter {
  readonly #site_map: SiteMapReader;

  constructor(site_map: SiteMapReader = site_map_reader) {
    this.#site_map = site_map;
  }

  present(session: Session): SiteHome {
    const visible = this.#site_map.visible(session)
      .filter((destination) => destination.in_hub);
    const sections = group_order
      .map((group) => this.#section(group, visible))
      .filter((section) => section.entries.length > 0);
    const authenticated = session.kind === "authenticated";
    return {
      eyebrow: authenticated ? "Creator home" : "Content at a URL",
      headline: "iam-pager",
      intro: authenticated
        ? "Pick a destination: publish a new page, manage what you already published, or explore what is public."
        : "Associate content with a path of your choosing and share the direct URL without this site's wrapper. Start with the demo, or publish a trial page right away.",
      sections,
    };
  }

  #section(
    group: SiteDestinationGroup,
    visible: readonly SiteDestinationDefinition[],
  ): SiteHubSection {
    const copy = group_copy[group];
    const entries = visible
      .filter((destination) => destination.group === group)
      .map((destination) => ({
        id: destination.id,
        href: destination.href,
        label: destination.label,
        summary: destination.summary,
        primary: destination.id === copy.primary,
      }));
    return {
      group,
      title: copy.title,
      description: copy.description,
      entries,
    };
  }
}

export const site_home_presenter: SiteHomePresenter =
  new SiteMapHomePresenter();
