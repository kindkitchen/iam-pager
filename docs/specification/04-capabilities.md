# Capabilities

Priorities describe product sequencing, not implementation order:

- **Core** — part of the candidate smallest coherent product.
- **Conditional** — included only after the linked need and safety model are
  confirmed.
- **Deferred** — deliberately outside the initial boundary.

## Locator resolution and delivery

- **CP-001 — Core:** Resolve a syntactically valid locator to one page outcome
  under canonical matching rules.
- **CP-002 — Core:** Authorize each request according to page, actor, lifecycle,
  and policy state.
- **CP-003 — Core:** Deliver supported first-party content with defined media,
  cache, disposition, integrity, and failure behavior.
- **CP-004 — Core:** Provide a site-mediated page view without confusing
  platform UI with creator-controlled content.
- **CP-005 — Core:** Represent missing, invalid, private, removed, restricted,
  and temporarily unavailable outcomes intentionally. External responses may be
  intentionally equivalent where disclosure would be unsafe.
- **CP-006 — Conditional:** Record useful delivery measurements under an agreed
  privacy and bot-handling model.

## Account and namespace management

- **CP-100 — Core:** Establish and end authenticated creator sessions safely.
- **CP-101 — Core:** Claim an available namespace using canonical validation and
  conflict rules.
- **CP-102 — Core:** List namespaces controlled by the current account.
- **CP-103 — Conditional:** Claim additional namespaces.
- **CP-104 — Deferred:** Rename, transfer, or delegate namespace authority until
  lifecycle and recovery rules exist.

Account registration, identity providers, recovery, and deletion remain Open.
Authentication work cannot be reduced to a login screen.

## Page management

- **CP-200 — Core:** Create a page with a non-conflicting locator, supported
  content, and explicit initial access/listing state.
- **CP-201 — Core:** List and inspect all pages the creator can manage,
  regardless of public discoverability.
- **CP-202 — Core:** Update content and metadata without exposing partial state.
- **CP-203 — Core:** Change access and listing states under valid transition
  rules.
- **CP-204 — Core:** Remove a page under the agreed retention and locator
  lifecycle contract.
- **CP-205 — Conditional:** Rename a page once old-locator behavior is decided.
- **CP-206 — Conditional:** Duplicate a page with an explicit content-copy and
  metadata-copy contract.
- **CP-207 — Conditional:** Apply bulk changes with per-page authorization,
  validation, and result reporting.
- **CP-208 — Conditional:** Tag pages under normalization, limit, and mutation
  rules.

## Discovery

- **CP-300 — Conditional:** Browse or search pages that are both listed and
  policy-eligible.
- **CP-301 — Conditional:** Search by normalized page name, namespace, and tags
  with defined matching and pagination behavior.
- **CP-302 — Conditional:** Navigate from an eligible page to its namespace and
  other eligible pages.
- **CP-303 — Deferred:** Search content text after extraction support, content
  eligibility, privacy, freshness, cost, and removal behavior are defined.
- **CP-304 — Deferred:** Rank by view counts until count semantics and abuse
  resistance are defined.

Public access alone does not enroll a page into discovery.

## Guest publishing

All guest publishing capabilities are Conditional and blocked by Q-004.

- **CP-400:** Create content without a registered account while preserving a
  private proof of management authority.
- **CP-401:** Enforce understandable content, storage, request-frequency, and
  retention limits.
- **CP-402:** Prevent locator collision from replacing another creator's page.
- **CP-403:** Allow an authorized guest to update or remove their page within
  the retention window.
- **CP-404:** Convert guest ownership to an authenticated account without
  allowing account takeover or breaking published locators.

The product should omit guest publishing rather than ship it with overwrite,
unbounded abuse, or unknowable retention behavior.

## External storage providers

All provider capabilities are Deferred and blocked by Q-008.

- **CP-500:** Connect and revoke a provider grant with least necessary
  authority.
- **CP-501:** Select content only within the creator's granted provider scope.
- **CP-502:** Bind a page to provider content under an explicit copy, proxy,
  redirect, or synchronization contract.
- **CP-503:** Communicate freshness and provider failures without serving stale
  or unauthorized content contrary to policy.
- **CP-504:** Reauthorize, change, or disconnect a provider with explicit impact
  on bound pages.
- **CP-505:** Avoid leaking credentials, private provider identifiers, and
  upstream authorization behavior to visitors.

"Support GitHub" or "support Google Drive" is not a ready task until these
provider-independent outcomes are decided.

## Platform safety and operations

These capabilities are Core for any public deployment even though they were
absent from the original README:

- **CP-600 — Core:** Enforce content-size, request-rate, and resource-use limits
  at creation and delivery boundaries.
- **CP-601 — Core:** Restrict, remove, and investigate content under an explicit
  policy and auditable authority model.
- **CP-602 — Core:** Receive or initiate abuse handling without requiring public
  exposure of reporter or account secrets.
- **CP-603 — Core:** Identify operational failures separately from valid
  not-found or unauthorized outcomes.
- **CP-604 — Core:** Protect management sessions from creator-controlled active
  content.
- **CP-605 — Core:** Revoke compromised account, guest, or provider authority
  and understand the affected pages.
- **CP-606 — Core:** Export or remove account data under the eventual privacy
  and retention contract.
