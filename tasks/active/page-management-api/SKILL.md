---
name: page-management-api
description: Deliver API-first core page management for authenticated creators, including explicit create/list/inspect/update/access/delete contracts and private direct delivery. Load when working on managed pages, page persistence, page APIs, or delivery authorization.
created: 2026-07-19
updated: 2026-07-19
tags: [api, backend, security, storage]
relates: []
---

Active; implementing `003.plan.md`. Steps 2-7 are delivered (`005.log` through
`008.log`): `lib/page/` now holds the invariant-checked model, atomic repository
contract, conforming memory/Deno KV adapters, namespace-authority resolver,
HTTP/session-independent `PageService`, and strict Fresh-independent
`PageHttpAdapter`.

The HTTP boundary provides bounded nested create/PATCH decoding, strict list
queries and pagination, owner-safe list/inspection presenters, shared
constant-time CSRF validation, session-derived trial-versus-managed dispatch,
and canonical page/revision ETags for revision-bound PATCH/DELETE. A stale
creator request cannot downgrade to a guest trial. All management/error
responses are no-store, owner IDs and stored derivations stay off wire, and the
concrete pending-route contract is documented in `docs/api/pages.md`.

Next: step 8, select `PageRepository` storage in composition, expose page
service/HTTP interfaces from `AppServices`, and move Fresh collection/item routes
to the adapter. The new adapter is not selected by current route composition yet;
the legacy locator-only endpoint remains public until that migration.

No production-data migration or legacy API compatibility is required. Rename,
duplicate, bulk actions, tags, filters beyond namespace, search, and management
UI remain later DS-MANAGE work. Current gates: check, build, and all 406 tests
pass.
