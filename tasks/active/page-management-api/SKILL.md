---
name: page-management-api
description: Deliver API-first core page management for authenticated creators, including explicit create/list/inspect/update/access/delete contracts and private direct delivery. Load when working on managed pages, page persistence, page APIs, or delivery authorization.
created: 2026-07-19
updated: 2026-07-19
tags: [api, backend, security, storage]
relates: []
---

Active; implementing `003.plan.md`. Steps 1-11 are delivered: the page model,
memory/Deno KV repositories, application service, strict management HTTP
adapter, storage selection, Fresh collection/item routes, session-authorized
direct delivery, and nested/CSRF-aware publishing form are composed into the
running application.

The superseded locator-only `ContentRepository`, publishing services, HTTP
adapters, page record types, conformance suites, and tests are removed.
`PageService`, `PageRepository`, and their management/direct HTTP boundaries are
the only page mutation, delivery, and persistence path.

Next: finish documentation/acceptance, run local smoke verification, and close
the task. Current gates: check, build, and all 345 remaining tests pass.
