---
name: platform-architecture
description: iam-pager layering, core interfaces, persistence, security posture, and deliberate open scope. Load for orientation before changing lib/, routes/, or storage composition.
updated: 2026-07-25
sources: [project-baseline]
---

`iam-pager` publishes Markdown or PDF content at deterministic namespace and
optional page-name locators. Direct paths return content bytes; the site under
`/site` is a separate projection (hub, publishing, wrapped viewing, exploration,
namespace reservation, creator management). Product rules live in `lib/`.

Guests may publish public, undiscoverable trials in unreserved namespaces.
Google-authenticated creators reserve namespaces and perform exact-revision
managed mutations. Missing, private, invalid, and unauthorized visitor reads
share one non-disclosing `404`. The platform assigns no meaning or relationship
between pages.

## Layering rule

Logic is raw code behind interfaces; every other layer is a projection.

- `LocatorEngine` — transport-independent locator validation and formatting.
- `PageService` — publication, authority, lifecycle, delivery, queries.
- `PageAggregateRepository` — assets, pages, endpoint claims, projections.
- Focused identity, namespace, session, authentication, content-handler,
  presenter, and HTTP interfaces alongside them.
- Presenters return complete bounded view models; components render models and
  prepare requests without deciding authority or persistence; Fresh routes
  resolve request context, call one adapter operation, and map its result.

An implementation stays valid when it satisfies a current interface, even if no
composition selects it. Memory and Deno KV implementations pass the same
repository conformance suites.

## Persistence and security

Deno KV stores strict identity, namespace, session, aggregate, endpoint,
projection, and manifest-backed content records. Content is staged, hashed, and
verified before publication. Visibility changes use one native atomic commit.
Corrupt or incoherent records fail closed.

Every routed request receives a typed guest/authenticated session and a server
request ID. Bearers, OAuth state, and CSRF values are bounded; persisted bearer
and state lookup values are hashes. Authentication consumes one-use attempts,
rotates credentials, and never exposes provider tokens. Logout revokes
authenticated access and creates an unrelated guest session.

Fresh-independent HTTP adapters enforce bounded strict JSON/multipart shapes,
CSRF, strong revision ETags, request limits, no-store policy, content isolation,
explicit disposition, and PDF validator/range semantics. Direct active content
never receives the platform shell. Wrapped Markdown is sandboxed and
no-referrer; PDF uses the browser-native viewer with explicit direct and
download links.

## Verification

`deno task verify` (format, lint, type check, full test suite) and the
production Fresh build are the gate for every change.

## Deliberate open scope

Not implemented: quotas, publishing rate limits, guest expiry, account deletion,
backup/retention guarantees, orphan sweeping, full-text/relevance indexes,
generic or active content, PDF text extraction/PDF.js. Memory storage is
process-local; durable deployments must select Deno KV. Local fake
authentication must remain loopback-only or on a narrow designated preview host.
PDF validation is structural screening, not malware certification.
