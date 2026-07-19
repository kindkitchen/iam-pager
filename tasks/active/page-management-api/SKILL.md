---
name: page-management-api
description: Deliver API-first core page management for authenticated creators, including explicit create/list/inspect/update/access/delete contracts and private direct delivery. Load when working on managed pages, page persistence, page APIs, or delivery authorization.
created: 2026-07-19
updated: 2026-07-19
tags: [api, backend, security, storage]
relates: []
---

Active; implementing `003.plan.md`. Steps 2-6 are delivered (`005.log` through
`007.log`): `lib/page/` now holds the invariant-checked page model, atomic
repository contract, strict list cursors, backend-neutral conformance suite,
namespace-authority resolver, HTTP/session-independent `PageService`, and
conforming memory and Deno KV repositories.

The durable adapter uses a fresh schema-versioned page keyspace with coherent
ID, case-normalized locator, and ordered owner indexes plus immutable chunked
content generations. Conditional atomic commits cover trial replacement,
managed takeover, revision-bound content/access updates, and deletion across
repository instances. A tagged JSON codec preserves plain data and
`Uint8Array`; reads validate envelopes, indexes, identities, revisions, and
chunks and fail closed on corruption. Access-only updates retain the exact
content generation.

Next: step 7, implement strict Fresh-independent HTTP primitives and adapter:
ETags, shared CSRF, bounded request/query decoding, owner-safe presenters, and
exact status/error mapping. Then proceed to composition and routes in plan
order. The new page adapter is not selected by current route composition yet.

No production-data migration or legacy API compatibility is required. Rename,
duplicate, bulk actions, tags, filters beyond namespace, search, and management
UI remain later DS-MANAGE work. Current gates: check, build, and all 393 tests
pass.
