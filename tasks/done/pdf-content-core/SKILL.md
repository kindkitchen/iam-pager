---
name: pdf-content-core
description: PDF content validation and complete generic endpoint-set lifecycle are implemented. Load when reviewing PDF core limits, management metadata, profile compatibility, or endpoint-preserving page mutations.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, content, pdf, interfaces]
relates: [content-endpoint-bindings, kvdex-content-persistence, pdf-content-http]
---

Done, chain position 2 of 5. The pure PDF handler validates bounded detached
bytes and safe filename metadata, fixes media type, supports inline/attachment,
and keeps payload bytes out of management inspection.

Generic application commands plan complete endpoint intent for create/update,
preserve alternates on canonical rename, require a fresh complete set for
endpoint-aware duplication, and reject incompatible legacy persistence without
loss. Full process-local lifecycle/conflict coverage passes.

Next: `kvdex-content-persistence`. HTTP upload/ranges and PDF site projection
remain separate tasks.
