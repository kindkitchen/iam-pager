# Open questions and risks

## Decision order

Questions are ordered by how strongly they block coherent tasks. A decision
should record the chosen product behavior, alternatives considered, affected
requirements, and evidence that could cause reconsideration. It should not
select technology unless technology is the actual decision.

### Product blockers

1. **Q-001 — Initial user and use case:** Who is the first creator, what content
   are they publishing, and why is this preferable to an existing share link or
   static host? This determines content classes, durability, discovery, and
   acceptable complexity.
2. **Q-002 — Initial product boundary:** Is the smallest product authenticated
   first-party publishing plus direct delivery? Confirm whether site discovery,
   guest publishing, and provider storage are excluded from that boundary.
3. **Q-003 — Access model:** Are private, link-accessible, and listed-public the
   intended states? Define transitions and unauthorized visitor disclosure.
4. **Q-004 — Guest ownership and abuse:** Is guest publishing essential? If so,
   define unguessable management authority, collision prevention, retention,
   quotas, recovery, moderation, and account conversion before shaping work.
5. **Q-005 — Content contract:** Which media types and size bands are initially
   accepted, and are active HTML, scripts, archives, SVG, and forced downloads
   supported?
6. **Q-006 — Retention contract:** What can creators rely on after update,
   deletion, account closure, policy action, provider loss, or platform failure?
7. **Q-007 — Discovery promise:** Is known-link sharing enough initially? If
   not, define listing eligibility, searchable fields, ranking intent,
   moderation, and removal timing.

### Domain and experience blockers

8. **Q-008 — Locator grammar:** Decide host/path shape, default-page behavior,
   route reservations, normalization, case and Unicode handling, and canonical
   redirects without colliding with site and API routes.
9. **Q-009 — Locator lifecycle:** Define rename, redirect, tombstone, deletion,
   name reuse, namespace rename, and transfer behavior.
10. **Q-010 — Meaning of deterministic:** Confirm that it means one predictable
    resolution outcome for a request, not immutable content at a locator.
11. **Q-011 — Delivery mode:** Does the platform serve, proxy, or redirect
    content, and can behavior vary by storage source? Define privacy, cache,
    analytics, and outage consequences.
12. **Q-012 — Page changes:** Are revisions, drafts, rollback, preview, or
    concurrent-edit detection required initially?
13. **Q-013 — Views:** Is a view count product-critical? If yes, define counted
    events, bot and owner handling, privacy, accuracy, and update delay.
14. **Q-014 — Operator model:** Who can restrict content or accounts, under what
    policy, with what audit, notice, appeal, and emergency authority?

### Technical investigation blockers

15. **Q-015 — Active-content trust boundary:** What isolation properties and
    origin model prevent creator content from compromising management sessions
    or appearing platform-endorsed?
16. **Q-016 — Identity assurance:** What registration, verification, session,
    recovery, revocation, and deletion behavior does namespace ownership need?
17. **Q-017 — Data authority:** What is authoritative for page identity,
    content, metadata, visibility, discovery, and external bindings, and what
    consistency does each surface promise?
18. **Q-018 — External provider semantics:** If provider support is retained, is
    content copied, proxied, redirected, or synchronized? Define authority,
    freshness, grant, failure, and disconnect behavior before naming providers.
19. **Q-019 — Operating envelope:** Expected payloads, traffic, geography,
    availability, recovery, cost, legal jurisdiction, and support model.

## Required corrections to the original vision

| Original assumption                                           | Problem                                                                                                     | Specification treatment                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Any guest may overwrite a colliding guest page                | Enables trivial defacement and gives no ownership contract                                                  | **Must change:** collisions cannot replace another creator's content                                                 |
| On guest capacity, each new item removes the "latest"         | Ambiguous eviction target; silent loss is hostile and abusable                                              | **Open:** choose explicit reject, expiry, or eviction behavior with notice and recovery terms                        |
| Any page mismatch falls back to the main site                 | Turns invalid or missing direct content into a misleading success and breaks HTTP/client semantics          | **Must change:** return an intentional page outcome; a branded error may still link to the site                      |
| Authenticated content never disappears without creator action | Impossible under policy, law, account deletion, provider failure, corruption, quotas, or service closure    | **Must change:** publish a bounded retention and recovery contract                                                   |
| A page is namespace/name and content                          | Conflates durable identity, locator, mutable payload, and response                                          | **Clarified:** model page, locator, content, and content binding separately                                          |
| A page is either public or session-only                       | Conflates known-link access with listing in discovery                                                       | **Open with proposal:** separate access from listing and consider private, link-accessible, and listed-public states |
| "Raw content" has no site around it                           | Arbitrary active content may share trust with management sessions; raw still needs HTTP and safety controls | **Must change:** require explicit content semantics and isolation while keeping delivery visually direct             |
| "Redirect" and "display raw content" are interchangeable      | Serving, proxying, and redirecting differ in privacy, stability, headers, cost, and failure behavior        | **Open:** define delivery mode as a product contract                                                                 |
| Username is the namespace, plus extra namespaces              | Account identity, display identity, and locator ownership become hard to rename, recover, or transfer       | **Clarified proposal:** treat namespaces as separately owned resources                                               |
| Search all representable content                              | Extraction eligibility, privacy, cost, freshness, deletion, and ranking are undefined                       | **Deferred:** begin with metadata only if discovery is in scope                                                      |
| External providers are an add-on                              | They change authority, availability, credentials, caching, and deletion semantics                           | **Deferred:** define a provider-independent contract first                                                           |

## Risk register

| Risk                                                   | Consequence                                                                          | Required response before exposure                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Active creator content shares trust with management UI | Session theft, account action, convincing platform impersonation                     | Resolve Q-005 and Q-015; verify isolation and headers with negative tests   |
| Guessable or colliding guest authority                 | Defacement, data loss, spam, unrecoverable ownership                                 | Do not ship guest publishing until Q-004 is resolved                        |
| Locator grammar overlaps application routes            | Wrong content served, inaccessible management routes, permanent compatibility burden | Resolve Q-008 before publishing stable URLs                                 |
| Public access is treated as discovery consent          | Privacy surprise and irreversible indexing                                           | Resolve Q-003 and keep listing separate from access                         |
| Provider content changes outside the platform          | Stale, unauthorized, missing, or policy-violating responses                          | Resolve Q-018 and expose freshness/failure behavior                         |
| Mutable content receives unsafe caching                | Visitors receive stale private, deleted, or replaced content                         | Define cache invalidation and access-state propagation under TR-022/TR-042  |
| Content search retains removed or private data         | Privacy and policy breach                                                            | Keep content search deferred until removal and eligibility are demonstrable |
| Absolute durability promise cannot be met              | User data loss and loss of trust                                                     | Replace promise with Q-006 retention, backup, export, and recovery terms    |
| No operator/moderation actor                           | Abuse cannot be handled consistently or accountably                                  | Resolve Q-014 before public publishing                                      |
| Scope attempts guests, search, and providers together  | Core ownership and delivery semantics stay unvalidated                               | Confirm Q-002 and deliver coherent slices progressively                     |

## Recommended working assumption

Until the questions are answered, use the following only as a Proposed scope for
planning discussion:

> An authenticated creator controls one namespace, manages first-party content
> of a small supported set of types, chooses private, link-accessible, or
> listed-public access, and shares a stable direct-delivery locator. Discovery
> is metadata-only if included. Guest publishing and external providers are
> later experiments.

This is not accepted scope. Its purpose is to expose a smaller decision surface
and prevent unsafe optional features from silently defining the architecture.
