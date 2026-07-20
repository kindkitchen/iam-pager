---
name: content-endpoint-bindings
description: Separate logical pages, immutable content assets, and user-configured delivery endpoint bindings as the prerequisite for PDF preview/download. Load when changing page/content identity, multiple locators, delivery profiles, or one-content-to-many-endpoint behavior.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, content, domain, interfaces]
relates: [pdf-content-core, kvdex-content-persistence]
---

Active, chain position 1 of 5. The endpoint-set policy and pure planning
boundary are implemented: one explicit canonical binding plus up to seven
ordered alternates, one case-insensitive namespace, unique validated ordinary
locators, and content-declared `inline`/`attachment` support. `md-page` is
inline-only and `.pdf` remains behavior-free.

Next: introduce immutable content asset identity/access and atomic page/endpoint
aggregate interfaces, then implement the memory reference and shared conformance
suite while preserving current one-endpoint `md-page` API behavior. See
[[003.decision]] and [[006.decision]].
