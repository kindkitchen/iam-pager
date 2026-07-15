# Domain and addressing

## Core terms

### Account

An authenticated principal and its lifecycle. Authentication identity, display
name, and public namespace are related but not assumed to be the same value.

### Namespace

A unique, creator-controlled component of page locators. An account may control
more than one namespace. Transfer, rename, reservation, and reuse rules are
Open.

### Page

A managed record with an identity, owner-controlled namespace, optional page
name, access state, metadata, lifecycle state, and content binding. A page is
not the same thing as its bytes, its rendered representation, or an HTTP
response.

### Content

The payload associated with a page plus the metadata required to deliver it
correctly, such as media type, size, and integrity information. Supported
content may be textual or binary. "Raw" means direct content delivery, not an
absence of protocol, authorization, policy, or safety controls.

### Content binding

The relationship between a page and content controlled by first-party storage or
an external provider. The binding's authority, freshness, and failure semantics
are Open.

### Locator

A canonical public address derived from routing rules and page identity. A
locator identifies a page outcome; it does not guarantee that content is public,
available, immutable, or permanently retained.

### Site-mediated view

A platform page that presents creator and page context. It is distinct from the
direct content-delivery endpoint.

## Identity and ownership

- **DM-001 — Baseline:** Every managed page has one accountable owner. Future
  shared ownership would require a separate authorization model.
- **DM-002 — Baseline:** Namespace authority is checked for every page mutation,
  not inferred from locator text supplied by a client.
- **DM-003 — Baseline:** Namespace and page uniqueness use one server-defined
  normalization and comparison rule.
- **DM-004 — Proposed:** Page identity is stable independently of its mutable
  locator and content binding. This permits explicit rename and provider-change
  semantics without conflating them with deletion and recreation.
- **DM-005 — Open:** Ownership and recovery model for guest-created pages.

## Locator model

The original shape — namespace plus an optional page name — is retained as a
concept, not yet as a route grammar.

- **DM-010 — Baseline:** A named page locator identifies one page within one
  namespace.
- **DM-011 — Proposed:** A namespace-only locator may identify a configured
  default page. The absence of one produces an explicit outcome and must not
  select an arbitrary page.
- **DM-012 — Baseline:** Canonicalization is deterministic across creation,
  lookup, rename, search, and conflict checks.
- **DM-013 — Baseline:** Application routes, static assets, API routes, and page
  locators cannot ambiguously claim the same request.
- **DM-014 — Baseline:** Invalid locators and unresolved valid locators are
  distinguishable internally and have intentional external responses.
- **DM-015 — Open:** Hostname and path structure, reserved names, character
  repertoire, Unicode policy, case handling, length limits, percent-encoding,
  trailing separators, and canonical redirects.
- **DM-016 — Open:** Whether a locator identifies the current mutable page or a
  fixed content revision. "Deterministic" currently means deterministic
  resolution, not immutable content.

Example URLs must wait for DM-015. Publishing examples now would accidentally
turn a placeholder route into a compatibility promise.

## Rename, removal, and reuse

- **DM-020 — Open:** Whether renaming a page leaves a redirect, tombstone, or no
  record at the old locator; for how long; and whether access state carries to
  that outcome.
- **DM-021 — Open:** Whether namespace rename or transfer is supported and how
  all contained page locators behave.
- **DM-022 — Open:** Whether deleted namespace or page names can be reused, by
  whom, and after what protection period.
- **DM-023 — Baseline:** A creator action that changes a shared locator must
  explain the resulting link behavior before confirmation.
- **DM-024 — Proposed:** Internal deletion and public unavailability are
  separate lifecycle events so retention, recovery, legal hold, and index
  removal can be reasoned about explicitly.

## Content contract

- **DM-030 — Baseline:** A content binding includes enough validated metadata to
  return an intentional media type and size behavior.
- **DM-031 — Baseline:** Delivery does not trust file extensions or
  creator-supplied headers without validation.
- **DM-032 — Open:** Initially supported media types, maximum sizes, character
  encoding rules, active-content policy, disposition behavior, and whether
  archives or multipart content are supported.
- **DM-033 — Open:** Support for conditional requests, byte ranges, content
  negotiation, compression, cache validation, and download filenames by content
  class.
- **DM-034 — Baseline:** Content changes cannot produce partially updated or
  internally contradictory metadata and payload state.
- **DM-035 — Open:** Whether changes create revisions, whether old revisions can
  be addressed, and what recovery guarantees exist.

## Access, listing, and policy eligibility

These are separate properties:

- **Access** answers whether this requester may receive content.
- **Listing** answers whether the platform may expose the page in discovery.
- **Policy eligibility** answers whether the platform is willing to host,
  deliver, embed, or list it.
- **Availability** answers whether the content can currently be served.

- **DM-040 — Baseline:** Listing never grants access that the page's access
  state denies.
- **DM-041 — Baseline:** A public locator does not imply listing or endorsement.
- **DM-042 — Baseline:** Policy restriction can override creator-selected access
  and listing state.
- **DM-043 — Open:** State-transition rules, moderation states, appeal behavior,
  and what owners and visitors can learn about restrictions.

## Retention and counters

- **DM-050 — Must change:** "Authenticated content will not disappear until the
  user's explicit action" is not a viable absolute promise. Account deletion,
  policy enforcement, legal obligations, corruption recovery, storage limits,
  and service discontinuation require a stated retention contract.
- **DM-051 — Open:** Retention, backup, restore, soft deletion, export, account
  closure, and provider-disconnection guarantees.
- **DM-052 — Open:** Definition of a view, duplicate and bot filtering,
  aggregation delay, privacy retention, and whether counts are exact or
  approximate.
