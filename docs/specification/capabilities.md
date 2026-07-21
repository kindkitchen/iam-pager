# Application capabilities

Capabilities are transport-independent interfaces. Fresh routes, API adapters,
and site presenters consume them; they do not reimplement their rules.

## CP-LOCATOR — Locator capability

`LocatorEngine` validates namespace/page-name intent and delegates concrete URL
mapping to a strategy. Publishing, lookup, ownership, endpoint planning, and
link presentation use this one boundary.

## CP-PAGE — Page application capability

`PageService` composes focused interfaces for:

- trial publication and managed creation;
- owner-safe list and inspection;
- revision-bound update, rename, duplicate, and delete;
- bounded per-item bulk access and deletion;
- direct delivery and wrapped public viewing;
- namespace public listing and cross-namespace exploration.

It accepts typed guest/user actors, resolves namespace authority through an
interface, validates content through registered handlers, plans complete
endpoint sets, and returns presentation-safe results. It has no dependency on
sessions, HTTP, Fresh, or a concrete repository.

## CP-PERSISTENCE — Page persistence capability

`PageAggregateRepository` composes focused content-asset, logical-page,
endpoint-resolution, mutation, and query interfaces. Implementations must:

- create/read immutable content assets;
- resolve every canonical or alternate endpoint;
- publish trial and managed pages atomically;
- update content reference, endpoints, access, and tags at one revision;
- duplicate and delete complete logical pages;
- list owner/public logical pages without endpoint-row duplication.

`MemoryPageAggregateRepository` and `KvPageAggregateRepository` satisfy the same
conformance suite. This interface is the selected page persistence boundary; the
service has no backend-specific path.

## CP-CONTENT — Content handlers

A `ContentTypeHandler` validates transport-neutral input, derives stored data,
renders delivery payloads, returns bounded management data, and declares its
supported endpoint profiles.

`MdPageHandler` and `PdfHandler` are current implementations. HTTP owns JSON,
multipart, ranges, and response headers; components own file selection and draft
feedback. None of those concerns enter handlers.

## CP-AUTHORITY — Identity and namespace capability

`IdentityRepository` maps a verified `(strategy_id, provider_subject)` to one
application user. `NamespaceReservationManager` atomically reserves and lists
namespaces. `NamespaceAuthorityResolver` exposes only whether the current page
actor sees a namespace as unreserved, owned, or reserved by another user.

Authentication alone does not grant publishing authority.

## CP-SESSION — Session capability

`SessionManager` resolves opaque bearers into typed guest/authenticated
sessions, creates bounded authentication attempts, rotates credentials on
upgrade, and revokes authenticated access on CSRF-bound logout.
`SessionTransport` maps the bearer to a cookie independently from repository
storage.

## CP-AUTH — Authentication capability

`AuthenticationStrategy` abstracts provider begin/complete behavior.
`AuthenticationOrchestrator` owns state, identity persistence, logical-session
upgrade, and credential rotation. Google through gauth is the current strategy;
provider tokens and failures do not cross its adapter boundary.

## CP-PRESENTATION — Site capability

Presenters under `lib/ui/` map raw capability results into complete bounded view
models for navigation, namespace reservation, publishing, management,
exploration, and wrapped viewing. Components render those models and prepare
requests; they receive neither owner identity nor responsibility for deciding
authority.

## CP-HTTP — HTTP capability

Fresh-independent adapters own strict request shape and size bounds, session/
CSRF preconditions, ETags, multipart parsing, ranges, status mapping, no-store
policy, and direct-content isolation. Fresh routes choose an adapter operation
and pass resolved request context.
