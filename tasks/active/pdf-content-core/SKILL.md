---
name: pdf-content-core
description: Implement PDF as a specific content capability over shared page/content/endpoint contracts. Load when working on PDF validation, metadata, supported delivery profiles, or preview-versus-download behavior.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, content, pdf, interfaces]
relates: [content-endpoint-bindings, kvdex-content-persistence, pdf-content-http]
---

Active, chain position 2 of 5. The transport-independent handler step is
implemented: bounded detached bytes, explicit lightweight PDF structure and
portable filename validation, fixed media type, inline/attachment declaration,
and byte-free management metadata are composed through the generic page service.

Next: add complete endpoint-set intent to generic application commands and
preserve configured PDF alternates through create, endpoint update, rename, and
duplication. Then close the core task with full lifecycle/conflict coverage.
HTTP upload/ranges, Kvdex persistence, and PDF site projection remain separate.
