import type { Session } from "../session/model.ts";

/** Editorial destinations: explanatory pages with no owned state. */
export type SiteEditorialTopic = "about" | "demo" | "invite";

export interface SiteEditorialLink {
  readonly label: string;
  readonly href: string;
  /** Emphasised call to action; at most one per action list. */
  readonly primary?: boolean;
}

export interface SiteEditorialSection {
  readonly heading: string;
  readonly body: readonly string[];
  /** Verbatim example (a locator, a URL, a snippet), rendered as code. */
  readonly example?: string;
  readonly links?: readonly SiteEditorialLink[];
}

/** Complete server-owned model of one editorial page. */
export interface SiteEditorialPage {
  readonly topic: SiteEditorialTopic;
  readonly eyebrow: string;
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly SiteEditorialSection[];
  readonly actions: readonly SiteEditorialLink[];
}

export interface SiteEditorialPresenter {
  present(topic: SiteEditorialTopic, session: Session): SiteEditorialPage;
}

/**
 * Static copy plus the few session-dependent decisions. Components receive a
 * finished page model and never branch on the session themselves.
 */
export class DefaultSiteEditorialPresenter implements SiteEditorialPresenter {
  present(topic: SiteEditorialTopic, session: Session): SiteEditorialPage {
    const authenticated = session.kind === "authenticated";
    switch (topic) {
      case "about":
        return about_page;
      case "demo":
        return demo_page;
      case "invite":
        return authenticated ? signed_in_invite_page : guest_invite_page;
    }
  }
}

const about_page: SiteEditorialPage = {
  topic: "about",
  eyebrow: "About",
  title: "A URL is the product",
  intro:
    "iam-pager publishes content at deterministic, namespace-based URLs. Opening a page URL returns the content itself; this site is a separate projection for publishing, exploring, and management.",
  sections: [
    {
      heading: "Addressing",
      body: [
        "A locator is a namespace plus an optional page name. A namespace-only locator addresses its default page. Locator identity is case-insensitive while your casing is preserved.",
        "`site`, `api`, and `auth` are reserved namespaces.",
      ],
      example: "/<namespace>[/<page-name>]",
    },
    {
      heading: "One page, many paths",
      body: [
        "A logical page keeps one stable management identity, one immutable content asset, and a set of locator references. Any number of valid URLs may point at the same content.",
        "Each reference binds a locator to an explicit delivery profile — open in the browser, or download as an attachment. Suffixes and path shapes never imply behavior.",
      ],
    },
    {
      heading: "What it deliberately is not",
      body: [
        "The platform assigns no meaning to a page or to relationships between pages; that stays your responsibility.",
        "Missing, private, invalid, and unauthorized lookups share one non-disclosing 404, so a URL never leaks whether it exists.",
      ],
    },
    {
      heading: "Same capabilities over the API",
      body: [
        "Everything this site does runs through the same application services the HTTP API exposes. API keys drive publishing and management without a browser.",
      ],
      links: [{ label: "API keys", href: "/site/api-keys" }],
    },
    {
      heading: "Agents work here too",
      body: [
        "A published agent skill describes the whole API surface, how a key must be stored, and how an agent should behave when it hits a limit. Copy it into your agent, hand it a scoped key, and it manages your pages on your behalf.",
        "Any page can be locked with “Block API writes” in page management. Locked pages refuse every key-authenticated change, so an agent can never touch what you keep for yourself.",
      ],
      links: [
        { label: "Read the agent skill", href: "/site/skill" },
        { label: "Raw skill document", href: "/site/skill/raw" },
      ],
    },
  ],
  actions: [
    { label: "Publish a page", href: "/site/publish", primary: true },
    { label: "Read the agent skill", href: "/site/skill" },
    { label: "See the walkthrough", href: "/site/demo" },
  ],
};

const demo_page: SiteEditorialPage = {
  topic: "demo",
  eyebrow: "Demo",
  title: "From an empty path to a shared URL",
  intro:
    "Four steps, no account required for the first one. Trial pages published without a reserved namespace are public, undiscoverable, and replaceable by anyone.",
  sections: [
    {
      heading: "1. Choose the path first",
      body: [
        "Publishing starts with the URL, not with the content. Pick a namespace and an optional page name; leaving the page name empty makes it the namespace's default page.",
      ],
      example: "quiet-river/notes/today",
      links: [{ label: "Open the publish page", href: "/site/publish" }],
    },
    {
      heading: "2. Write Markdown or attach a PDF",
      body: [
        "Markdown pages come with a live preview and an editable stylesheet. A PDF is published as-is at the paths you configure.",
      ],
    },
    {
      heading: "3. Add aliases and delivery modes",
      body: [
        "One page can answer at several URLs. Each path carries its own delivery mode, so the same PDF can open in a browser at one URL and download at another.",
      ],
      example: "quiet-river/report → open · quiet-river/report-file → download",
    },
    {
      heading: "4. Share the direct URL",
      body: [
        "The published URL returns the content without this site's wrapper. Prefix the same locator with `/site/` when you want the wrapped view with its related-page links.",
      ],
      example: "/quiet-river/notes/today   ·   /site/quiet-river/notes/today",
      links: [{ label: "Browse public pages", href: "/site/explore" }],
    },
  ],
  actions: [
    { label: "Try it now", href: "/site/publish", primary: true },
    { label: "Read the details", href: "/site/about" },
  ],
};

const guest_invite_page: SiteEditorialPage = {
  topic: "invite",
  eyebrow: "Invitation",
  title: "Keep the paths you publish",
  intro:
    "Guest publishing works without an account, but a guest page has no owner: anyone can replace it, and it never appears in exploration. Signing in with Google turns you into a creator.",
  sections: [
    {
      heading: "Reserve namespaces",
      body: [
        "A reserved namespace is yours. Guests and other creators cannot write into it, and every page below it stays under your control.",
      ],
    },
    {
      heading: "Decide who sees a page",
      body: [
        "Creator pages can be public or private, tagged, filtered, renamed, duplicated, and deleted. Private pages answer with the same non-disclosing 404 as missing ones.",
      ],
    },
    {
      heading: "Automate with API keys",
      body: [
        "Issue scoped keys and drive publishing and management from CI, scripts, or an AI agent, with the same rules the site follows.",
      ],
      links: [{ label: "Agent skill", href: "/site/skill" }],
    },
  ],
  actions: [
    { label: "Publish a trial page first", href: "/site/publish" },
    { label: "See the walkthrough", href: "/site/demo" },
  ],
};

const signed_in_invite_page: SiteEditorialPage = {
  topic: "invite",
  eyebrow: "Invitation",
  title: "You already have a creator account",
  intro:
    "Signed-in creators reserve namespaces, publish into them, and manage every page from one place.",
  sections: [
    {
      heading: "Next steps",
      body: [
        "Reserve a namespace on the publish page, then manage what you published — including storage connections and API keys.",
      ],
      links: [
        { label: "Publish", href: "/site/publish" },
        { label: "Manage pages", href: "/site/manage" },
        { label: "API keys", href: "/site/api-keys" },
      ],
    },
  ],
  actions: [{ label: "Publish a page", href: "/site/publish", primary: true }],
};

export const site_editorial_presenter: SiteEditorialPresenter =
  new DefaultSiteEditorialPresenter();
