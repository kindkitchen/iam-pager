---
name: page-management-api
description: Deliver API-first core page management for authenticated creators, including explicit create/list/inspect/update/access/delete contracts and private direct delivery. Load when working on managed pages, page persistence, page APIs, or delivery authorization.
created: 2026-07-19
updated: 2026-07-19
tags: [api, backend, security, storage]
relates: []
---

Active; implementing `003.plan.md`. Steps 2-5 are delivered (`005.log`,
`006.log`): `lib/page/` now holds the invariant-checked page model, atomic
repository contract, strict list cursors, backend-neutral conformance suite,
memory adapter, repository-backed namespace-authority resolver, and the
HTTP/session-independent `PageService`.

The service covers public-only trial create/replace; managed create over an
owned reservation (including atomic trial replacement); owner-safe bounded
list and editable-source inspection; revision-bound content/access update and
deletion; and public/owner-private delivery. It retries generated-ID collisions
within a fixed bound, never exposes owner IDs or stored derivations in management
representations, and authorizes private delivery before handler lookup.

Next: step 6, implement the Deno KV `PageRepository` with fresh page keyspace,
chunked content, coherent ID/locator/owner indexes, conditional revisions,
corruption checks, and the unchanged conformance suite. Then proceed to HTTP
primitives/adapter and composition in plan order.

No production-data migration or legacy API compatibility is required. Rename,
duplicate, bulk actions, tags, filters beyond namespace, search, and management
UI remain later DS-MANAGE work. Current gates: check, build, and all 359 tests
pass.
