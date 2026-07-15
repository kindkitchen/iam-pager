# Quality and technical requirements

These requirements state properties the system must exhibit and questions a
design must answer. They intentionally do not select databases, identity
services, object stores, queues, search engines, deployment platforms, or URL
layouts.

## Existing constraints

- **TR-001 — Baseline:** Product code uses TypeScript with the strictest
  practical static checks; weakening checks requires a documented reason.
- **TR-002 — Baseline:** The current runtime and web framework are Deno and
  Fresh 2 with Preact and Vite.
- **TR-003 — Baseline:** `deno task check` is the minimum repository validation
  gate; feature work also needs behavior-level tests appropriate to its risk.
- **TR-004 — Proposed:** Treat the current stack as a constraint to validate,
  not an answer to storage, streaming, isolation, identity, search, or
  operations. Reconsider it only against observed requirements and migration
  cost.

## Security and trust

- **TR-010 — Baseline:** Authorization is enforced at each management and
  delivery boundary. UI visibility and knowledge of a locator are not
  authorization.
- **TR-011 — Baseline:** Creator-controlled active content cannot read or mutate
  management sessions, platform UI, other pages, or platform credentials. The
  isolation property is required; its mechanism is Open.
- **TR-012 — Baseline:** Content delivery prevents unsafe media-type inference,
  header injection, path traversal, and accidental executable interpretation.
- **TR-013 — Baseline:** State-changing operations resist cross-origin and
  request-forgery attacks appropriate to the selected session model.
- **TR-014 — Baseline:** Provider credentials and guest-management secrets are
  least-privileged, revocable, protected at rest and in transit, and excluded
  from content, URLs, analytics, and logs.
- **TR-015 — Baseline:** Retrieval from external locations cannot become an
  unrestricted network proxy or access internal infrastructure.
- **TR-016 — Baseline:** Upload, parsing, rendering, indexing, and download
  paths have bounded resource use and content-specific abuse controls.
- **TR-017 — Baseline:** Sensitive operations leave an audit trail whose access,
  integrity, and retention are defined.
- **TR-018 — Open:** Threat model, origin boundaries, malware handling, content
  security policy, download policy, and account security assurance level.

## Privacy and policy

- **TR-020 — Baseline:** Private page content and metadata are excluded from
  public discovery and unauthorized telemetry.
- **TR-021 — Baseline:** Logs and measurements collect no more account, network,
  locator, content, or provider data than a stated operational purpose needs.
- **TR-022 — Baseline:** Deletion and visibility changes propagate to delivery,
  discovery, caches, and derived indexes under documented timing guarantees.
- **TR-023 — Baseline:** Public content status does not waive creator or visitor
  privacy obligations.
- **TR-024 — Open:** Jurisdiction, age restrictions, data residency, retention,
  reporting, takedown, export, and erasure obligations.

## Correctness and data integrity

- **TR-030 — Baseline:** Namespace and locator uniqueness remains correct under
  concurrent creation, rename, deletion, and retry behavior.
- **TR-031 — Baseline:** A successful content change never exposes a payload
  paired with metadata from a different change.
- **TR-032 — Baseline:** Retried commands and provider events have defined
  duplicate behavior and cannot silently repeat destructive effects.
- **TR-033 — Baseline:** Derived discovery data can be rebuilt or reconciled
  from an identified authority without changing page ownership or access state.
- **TR-034 — Open:** Consistency expectations between management, direct
  delivery, discovery, counters, caches, and external providers.
- **TR-035 — Open:** Backup scope, recovery point, recovery time, restore
  testing, and corruption-detection expectations.

## HTTP and content interoperability

- **TR-040 — Baseline:** Direct delivery uses standards-compatible status,
  media, length, cache, and disposition behavior for each supported content
  class.
- **TR-041 — Baseline:** `HEAD` and other supported methods cannot bypass access
  controls or expose metadata that `GET` would conceal.
- **TR-042 — Open:** Redirect policy, conditional requests, byte ranges,
  compression, content negotiation, cross-origin access, and canonical-link
  behavior.
- **TR-043 — Open:** Whether provider outages are represented as page
  unavailability, stale service, redirect failure, or another explicit outcome.

## Performance and capacity

No unsupported numeric promises are introduced yet.

- **TR-050 — Baseline:** Define latency and availability objectives separately
  for direct delivery, management, and discovery before production launch.
- **TR-051 — Baseline:** Define supported payload-size bands and test delivery
  without requiring whole-payload buffering where that would violate the
  selected limits.
- **TR-052 — Baseline:** Capacity controls account for stored bytes, delivered
  bytes, request rates, page counts, indexing work, and provider work where
  relevant.
- **TR-053 — Baseline:** Overload behavior protects existing authorized content
  and management access from one actor or content class consuming unbounded
  resources.
- **TR-054 — Open:** Expected traffic shape, geographical needs, growth horizon,
  cost envelope, and acceptable degradation behavior.

## Reliability and operations

- **TR-060 — Baseline:** Health and monitoring distinguish platform failures
  from expected invalid, missing, unauthorized, restricted, and upstream
  outcomes.
- **TR-061 — Baseline:** Structured operational events can correlate a request
  and affected resource without recording content or secrets by default.
- **TR-062 — Baseline:** High-risk mutations and moderation actions expose
  enough evidence to investigate who acted, what changed, and the outcome.
- **TR-063 — Baseline:** Deployments and schema or content migrations have
  verifiable compatibility and recovery plans proportional to risk.
- **TR-064 — Open:** Deployment environment, service ownership, alert targets,
  incident response, maintenance windows, and support expectations.

## Accessibility and usability

- **TR-070 — Baseline:** Management, discovery, authentication, and
  site-mediated views are keyboard-operable and use semantic, perceivable
  interfaces.
- **TR-071 — Baseline:** Validation, partial bulk results, access changes, and
  destructive outcomes are communicated without relying only on color or
  transient notifications.
- **TR-072 — Open:** Accessibility conformance target and supported browser,
  device, locale, and language ranges.
- **TR-073 — Baseline:** Creator-supplied direct content is not presented as
  platform-accessible UI; the platform should state where accessibility remains
  the creator's responsibility.

## Verification

- **TR-080 — Baseline:** Requirements are verified at the lowest useful boundary
  and through end-to-end evidence for authorization, locator resolution, content
  delivery, and lifecycle transitions.
- **TR-081 — Baseline:** Security-sensitive negative cases are first-class
  tests: cross-owner mutation, private-content access, locator collisions,
  unsafe content metadata, stale grants, and restricted content.
- **TR-082 — Baseline:** Tests do not depend on live external providers for
  deterministic core validation; provider contracts still require controlled
  integration evidence.
- **TR-083 — Baseline:** Production-readiness evidence includes failure,
  recovery, capacity, and abuse scenarios, not only successful UI paths.

## Technical investigations still required

Each investigation should compare options against requirements, operational
cost, failure behavior, reversibility, and migration impact rather than start
with a preferred product:

1. account, session, recovery, and authorization boundary;
2. authoritative page and namespace data with concurrency guarantees;
3. first-party binary and text content storage and atomic metadata association;
4. direct-delivery routing and active-content isolation;
5. metadata and optional content search with removal guarantees;
6. quotas, rate controls, abuse response, and audit evidence;
7. provider authorization, retrieval, synchronization, and failure containment;
8. background or asynchronous work needed for indexing, cleanup, and providers;
9. deployment, observability, backup, recovery, and cost model.
