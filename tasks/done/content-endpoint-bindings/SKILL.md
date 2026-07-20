---
name: content-endpoint-bindings
description: Completed separation of logical pages, immutable content assets, and user-configured delivery endpoint bindings. Load when reviewing page/content identity, multiple locators, delivery profiles, or one-content-to-many-endpoint behavior.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, content, domain, interfaces]
relates: [pdf-content-core, kvdex-content-persistence]
---

Done, chain position 1 of 5. Endpoint planning, immutable assets, atomic page
aggregates, logical-page queries, safe complete endpoint links, and
endpoint-selected direct delivery are implemented. Management/public projections
remain one row per logical page while exposing canonical and alternate links.
The process-local `PageService` composes current `md-page` through the split
contracts; raw Deno KV deliberately retains its canonical-inline compatibility
path pending the Kvdex task.

Verified with all 479 tests, check, and production build. Next chain task:
`pdf-content-core`. Resume from [[010.summary]]; settled details are in
[[006.decision]], [[007.decision]], [[008.log]], and [[009.log]].
