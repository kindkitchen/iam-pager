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
- revision-bound update, external-content re-link, rename, duplicate, and
  delete;
- bounded per-item bulk access and deletion;
- owner-only external-health inspection and filtering;
- direct delivery and wrapped public viewing;
- namespace public listing and cross-namespace exploration.

It accepts typed guest/user actors, resolves every referenced namespace through
an authority interface, validates content through registered handlers, plans
non-empty complete endpoint sets, and returns presentation-safe results. It has
no dependency on sessions, HTTP, Fresh, or a concrete repository.

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
renders delivery payloads, returns bounded management data, and declares the
bounded delivery-profile identifiers it supports. Profiles are reference
attributes and may be extended without changing content or locator identity.

`MdPageHandler` and `PdfHandler` are current implementations. HTTP owns JSON,
multipart, ranges, and response headers; components own file selection and draft
feedback. None of those concerns enter handlers.

## CP-EXTERNAL-STORAGE — External payload capability

The selected external-storage boundary is an interface family under
`lib/external-storage`. `ExternalStorageProvider` exposes normalized provider
identity, mandatory read, optional write/delete capabilities, bounded payload
operations, and stable failure categories. A provider registry resolves it
without leaking SDK or OAuth behavior into page services. A shared conformance
suite fixes those semantics for every adapter; the memory adapter is the
reference implementation and test double.

`StorageConnectionRepository` now owns creator/provider active uniqueness,
owner-safe retained revocation metadata, and provider-only token access. Its
memory and Deno KV implementations share conformance; KV credentials are
separate connection-bound AES-256-GCM ciphertext and are deleted on revocation.
Later OAuth and management capabilities will own reauthorization and connection
health. Asset repositories persist only the external source reference and
authoritative local integrity metadata. Delivery authorizes the page first,
resolves the source through these interfaces, verifies complete bytes, and maps
missing or retryable provider outcomes through `ES-DELIVERY`. Web routes and
components do not call provider adapters directly.

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

## CP-APIKEY — API-key capability

`ApiKeyManager` owns the transport-independent key lifecycle: bounded create
with one-time bearer exposure, owner list/inspect, revision-bound metadata
replacement, immediate individual revoke, and atomic owner revoke-all.
`ApiKeyBearerResolver` maps a presented bearer to an active key principal or
nothing. `ApiKeyRepository` persists only hashes, metadata, owner indexes, and
revocation state; memory and Deno KV satisfy one conformance suite. Label,
permission, expiry, owner-isolation, and revision rules live in these
interfaces, not in HTTP or UI.

## CP-API-AUTH — API principal capability

`ApiRequestAuthenticator` resolves every `/api/**` request to exactly one guest,
browser-user, or API-key principal; a present `Authorization` header is
authoritative and fails closed without cookie fallback. `ApiOperationPolicy`
decides each operation: guests are rejected, browser mutations require the
synchronizer token, and key requests require the mapped explicit permission.
Page and namespace HTTP adapters consume these interfaces and add no
authorization rules of their own.

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
