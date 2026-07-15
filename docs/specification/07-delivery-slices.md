# Delivery slices

These slices are product increments, not implementation tasks or a committed
roadmap. They keep work centered on observable outcomes while technical options
remain open. A slice can move, split, or be rejected after its blocking
questions are answered.

## DS-00 — Resolve the safe product boundary

**Outcome:** The team can describe one initial creator, one publishing need, the
supported content boundary, the access model, and the service's responsibilities
without relying on unstated assumptions.

**Resolve first:** Q-001 through Q-007, Q-014, and Q-015.

**Evidence:**

- accepted MVP inclusion/exclusion statement;
- example visitor and creator journeys, including failures;
- initial content, access, retention, moderation, and isolation policies;
- measurable success and operating assumptions;
- threat analysis proportionate to the accepted content types.

No product implementation slice is ready until the relevant DS-00 decisions are
accepted.

## DS-01 — Establish account and namespace authority

**Outcome:** An authenticated creator can establish and later prove authority
over one canonical namespace; another actor cannot claim or mutate it.

**Likely requirements:** PR-005, EX-100 through EX-103, DM-001 through DM-005,
CP-100 through CP-102, TR-010, TR-013, TR-017, TR-030.

**Resolve first:** Q-008, Q-009, and Q-016.

**Acceptance evidence should cover:** canonical conflicts, concurrent claims,
session expiry, revocation, recovery boundaries, unauthorized mutation, and
auditable outcomes.

## DS-02 — Manage a first-party page privately

**Outcome:** A creator can create, inspect, update, and remove one private page
with supported first-party content while no unauthorized visitor can retrieve
it.

**Likely requirements:** EX-110 through EX-115, DM-020 through DM-035, CP-200
through CP-204, TR-030 through TR-035.

**Resolve first:** Q-005, Q-006, Q-008 through Q-012, and Q-017.

**Acceptance evidence should cover:** content validation, conflicting locators,
atomic metadata/content changes, concurrent actions, deletion and recovery
behavior, and cross-owner denial.

## DS-03 — Deliver a shareable page directly

**Outcome:** A creator can make an eligible page link-accessible and a visitor
receives correct content or an intentional failure without entering the
management site.

**Likely requirements:** EX-001 through EX-005, DM-010 through DM-016, DM-030
through DM-043, CP-001 through CP-005, TR-011, TR-012, TR-040 through TR-054.

**Resolve first:** Q-003, Q-005, Q-008 through Q-011, Q-015, Q-017, and Q-019.

**Acceptance evidence should cover:** canonical resolution, supported media,
authorization, active-content isolation, missing/private/restricted/unavailable
outcomes, cache changes, delivery size, and overload behavior.

## DS-04 — Make management usable at page-set scale

**Outcome:** A creator can understand and manage more than one page without
knowing locators from memory.

**Candidate scope:** management list and filters, tags, duplicate, rename, and
bulk access or deletion changes. Each capability can become its own slice if it
has independent value.

**Likely requirements:** EX-114, EX-120 through EX-122, CP-205 through CP-208,
TR-062, TR-070, and TR-071.

**Resolve first:** Q-009, Q-012, and Q-013 where view counts are included.

**Acceptance evidence should cover:** authorization per page, normalized
filters, partial failures, conflict feedback, destructive-action consequences,
and accessibility.

## DS-05 — Add site-mediated viewing and discovery

**Outcome:** A visitor can inspect context around an eligible page and find
pages that creators intentionally list.

**Likely requirements:** EX-010 through EX-023, DM-040 through DM-043, CP-300
through CP-302, TR-020 through TR-024, TR-033, and TR-070.

**Resolve first:** Q-003, Q-005, Q-007, Q-014, Q-015, and Q-017. Resolve Q-013
only if view counts affect discovery.

**Acceptance evidence should cover:** listing consent, private and restricted
exclusion, active-content separation, pagination and matching, stale-index
removal, creator navigation, and accessible fallback for unsupported previews.

Full-content search is not implied by this slice.

## DS-06 — Evaluate guest publishing

**Outcome:** Validate whether account-free publishing creates enough value to
justify a separate ownership, retention, quota, moderation, and recovery model.

**Status:** Conditional experiment, not committed delivery.

**Likely requirements:** EX-200 through EX-205 and CP-400 through CP-404.

**Resolve first:** Q-004 plus all public-delivery and operator blockers.

**Acceptance evidence should cover:** private management authority, collision
prevention, expiration or rejection behavior, abuse limits, compromised-secret
response, moderation, and safe account conversion. If these cannot be made
understandable and operable, reject the capability rather than weaken ownership.

## DS-07 — Evaluate an external storage provider

**Outcome:** Validate one provider-independent content-binding contract against
one real provider without making the provider the page's accidental product
model.

**Status:** Deferred experiment.

**Likely requirements:** EX-300 through EX-304, CP-500 through CP-505, TR-014,
TR-015, TR-034, TR-043, and TR-082.

**Resolve first:** Q-011, Q-017, Q-018, and Q-019.

**Acceptance evidence should cover:** least-privilege grant, content selection,
freshness, provider mutation and deletion, outage and rate limit, revoked grant,
disconnect, secret handling, network-boundary protection, and deterministic
contract tests.

## Task-shaping checklist

For each task derived from a ready slice, record:

1. the actor and outcome;
2. linked requirement and decision identifiers;
3. explicit exclusions;
4. successful, empty, invalid, unauthorized, conflicting, restricted, and
   unavailable examples that apply;
5. lifecycle and concurrent-operation behavior;
6. security, privacy, abuse, and accessibility considerations;
7. observable operational evidence;
8. test boundaries and production-readiness evidence;
9. documentation and compatibility changes;
10. rollback or recovery expectations where state can be lost or exposed.

A technical component is not a delivery slice by itself. "Add a database",
"build auth", or "integrate a provider" becomes actionable only when tied to a
ready outcome and evaluated constraints.
