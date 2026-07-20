---
name: content-endpoint-bindings
description: Separate logical pages, immutable content assets, and user-configured delivery endpoint bindings as the prerequisite for PDF preview/download. Load when changing page/content identity, multiple locators, delivery profiles, or one-content-to-many-endpoint behavior.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, content, domain, interfaces]
relates: [pdf-content-core, kvdex-content-persistence]
---

Todo/backlog, chain position 1 of 5; the complete PDF chain is parked.

The accepted direction is one logical page and one immutable content asset with
publisher-supplied ordinary endpoint locators and independently configured
delivery profiles. `.pdf` has no special meaning. Resume by settling generic
endpoint cardinality, canonical designation, profile compatibility, mutation,
namespace, and conflict rules before defining pure contracts and conformance.
See [[001.draft]], [[002.log]], [[003.decision]], and [[004.log]].
