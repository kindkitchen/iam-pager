# Experiences and scope

This file describes observable journeys. It intentionally does not define page
layouts, APIs, persistence models, or authentication mechanisms.

## Visitor journeys

### Open a known page locator

- **EX-001 — Baseline:** A visitor can request a canonical locator without first
  entering the management site.
- **EX-002 — Baseline:** A successful request returns the page's current
  authorized content using declared content metadata and intentional HTTP
  behavior.
- **EX-003 — Baseline:** Missing, unavailable, unauthorized, and invalid
  locators produce defined failure outcomes rather than silently returning the
  site's home page.
- **EX-004 — Open:** Whether delivery is performed by the service, redirected to
  a storage provider, or can vary by page. This decision affects stability,
  privacy, analytics, and availability.
- **EX-005 — Baseline:** Private content is never disclosed because a visitor
  knows or guesses its locator.

### Inspect a page through the site

- **EX-010 — Baseline:** An eligible page can be viewed in a site-mediated
  context that distinguishes platform UI from creator content.
- **EX-011 — Baseline:** The view can link to direct delivery, the creator's
  public profile or namespace, and other discoverable pages when those targets
  are eligible.
- **EX-012 — Open:** Which active content types can be embedded safely, which
  require isolation, and which should only be downloaded or linked.

### Explore public pages

- **EX-020 — Baseline:** Only pages explicitly eligible for listing appear in
  search or browsing results.
- **EX-021 — Proposed:** Initial discovery searches normalized page names,
  namespace names, and tags. Full-content matching is a separate capability.
- **EX-022 — Open:** Result ranking, pagination, freshness, language handling,
  moderation filtering, and the treatment of externally stored content.
- **EX-023 — Baseline:** Removing listing eligibility eventually removes the
  page from platform discovery according to a stated consistency target.

## Authenticated creator journeys

### Establish identity and namespace control

- **EX-100 — Baseline:** A creator can authenticate, choose an available
  namespace under defined naming rules, and prove continued authority to manage
  it.
- **EX-101 — Baseline:** Namespace uniqueness and canonical comparison do not
  depend on client behavior.
- **EX-102 — Open:** Account recovery, identity-provider changes, namespace
  transfer, account deletion, and namespace rename behavior.
- **EX-103 — Proposed:** Additional namespaces use the same ownership model as
  the first namespace; a username is account metadata, not necessarily the page
  locator itself.

### Manage a page

- **EX-110 — Baseline:** A creator can create, inspect, update, and delete a
  page within an owned namespace.
- **EX-111 — Baseline:** A creator can change page content, supported metadata,
  and access state with validation and an explicit success or failure outcome.
- **EX-112 — Baseline:** A conflicting locator cannot overwrite another page.
- **EX-113 — Proposed:** Duplicate creates a new page with a creator-reviewable,
  conflict-free locator; the naming rule remains Open.
- **EX-114 — Baseline:** Bulk operations must report the result of each selected
  page and must not imply all-or-nothing behavior unless atomicity is explicitly
  guaranteed.
- **EX-115 — Open:** Revision history, drafts, preview-before-publish, recovery
  after deletion, and concurrent-edit conflict handling.

### Find managed pages

- **EX-120 — Baseline:** A creator can list and filter pages they are authorized
  to manage without exposing them through public discovery.
- **EX-121 — Proposed:** Filters include normalized name, created and updated
  intervals, visibility, and tags.
- **EX-122 — Open:** Whether view counts are reliable enough to filter or sort,
  and how bots, creator views, privacy, and delayed aggregation affect them.

## Guest creator journey

Guest publishing is Proposed and blocked from implementation planning.

If retained, the experience must answer all of the following before work starts:

- **EX-200 — Open:** How a guest proves authority to update or delete content
  without making that authority public in the locator.
- **EX-201 — Must change:** A guest must not be able to overwrite another
  guest's content by choosing the same locator. The original collision behavior
  is excluded.
- **EX-202 — Open:** Whether content is rejected, expired, or evicted when a
  quota is reached; "each new one removes latest" is ambiguous and can destroy
  newly created or unrelated content.
- **EX-203 — Open:** Which limits apply by content, actor, network, and time
  window, and how shared networks avoid unacceptable false positives.
- **EX-204 — Open:** What retention, warning, recovery, reporting, and account
  conversion behavior guests receive.
- **EX-205 — Baseline if accepted:** Guest publishing must not weaken content
  policy, isolation, rate, audit, or takedown requirements.

## External storage journey

External storage is Deferred until its authority model is defined.

- **EX-300 — Open:** A creator can connect a provider without exposing provider
  credentials to visitors, content, logs, or unrelated accounts.
- **EX-301 — Open:** The creator can select or bind provider content only within
  granted authority.
- **EX-302 — Open:** The product communicates whether provider content is
  copied, proxied, redirected, or synchronized, and which system is
  authoritative.
- **EX-303 — Open:** Provider timeout, revocation, deletion, rename, rate limit,
  stale content, and authorization failures have defined page outcomes.
- **EX-304 — Open:** Disconnecting a provider has explicit consequences for
  existing pages and cached or copied content.

## Access states

The original public/private flag combines addressability and discovery. That is
insufficient and must be clarified before implementation.

| Candidate state | Known locator            | Platform discovery            | Creator access | Status                                    |
| --------------- | ------------------------ | ----------------------------- | -------------- | ----------------------------------------- |
| Private         | Denied unless authorized | Excluded                      | Allowed        | Baseline                                  |
| Link-accessible | Allowed                  | Excluded                      | Allowed        | Proposed; commonly called unlisted        |
| Listed public   | Allowed                  | Included when policy-eligible | Allowed        | Proposed replacement for ambiguous public |

Whether a private page appears to an unauthorized visitor as missing or denied
is a security and product decision. Internal observability still needs the true
reason even when the external response intentionally conceals it.
