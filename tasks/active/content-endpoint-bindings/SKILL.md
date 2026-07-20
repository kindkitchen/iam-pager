---
name: content-endpoint-bindings
description: Separate logical pages, immutable content assets, and user-configured delivery endpoint bindings as the prerequisite for PDF preview/download. Load when changing page/content identity, multiple locators, delivery profiles, or one-content-to-many-endpoint behavior.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, content, domain, interfaces]
relates: [pdf-content-core, kvdex-content-persistence]
---

Active, chain position 1 of 5. Endpoint planning, immutable assets, atomic page
aggregates, and logical-page query capabilities are implemented. The
process-local `PageService` now stages `md-page` assets, mutates aggregate
references/endpoints, resolves delivery through endpoint bindings, and projects
one canonical row without JSON/API behavior drift. The memory compatibility
repository is backed by the split reference; raw Deno KV deliberately remains on
the legacy service path pending its planned replacement.

Current HTTP/JSON behavior still exposes one canonical inline `md-page`
endpoint. Next: add safe explicit endpoint links to owner/public projections and
endpoint-selected direct delivery without allowing aliases into list/search
cardinality. See [[006.decision]], [[007.decision]], and [[008.log]].
