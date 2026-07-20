---
name: content-endpoint-bindings
description: Separate logical pages, immutable content assets, and user-configured delivery endpoint bindings as the prerequisite for PDF preview/download. Load when changing page/content identity, multiple locators, delivery profiles, or one-content-to-many-endpoint behavior.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, content, domain, interfaces]
relates: [pdf-content-core, kvdex-content-persistence]
---

Active, chain position 1 of 5. Endpoint-set planning plus the split persistence
foundation are implemented. Immutable content assets are staged behind focused
create/read capabilities; a logical page aggregate references one asset and one
complete canonical/alternate endpoint set. Granular atomic mutation contracts,
the process-local reference, and shared conformance cover complete claims,
takeover, moves, coherent asset switches, immutable sharing, and deletion.

The composed service, old repositories, and JSON API deliberately still expose
one canonical inline `md-page` endpoint. Next: refactor `PageService` and current
projections onto the split capabilities without behavior drift, then expose safe
explicit endpoint links. See [[006.decision]] and [[007.decision]].
