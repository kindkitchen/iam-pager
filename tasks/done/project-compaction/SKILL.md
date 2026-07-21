---
name: project-compaction
description: Compact iam-pager around its current product goal without changing behavior. Load when pruning specifications, tasks, compatibility paths, legacy code, or obsolete tests.
created: 2026-07-21
updated: 2026-07-21
tags: [architecture, maintenance]
relates: []
---

Completed: the current product is documented directly and `PageAggregateRepository` is the sole page persistence boundary for memory and Deno KV.
Legacy page storage, migration/release compatibility machinery, disconnected adapter modes, and their tests are removed. Current application behavior remains in raw services/presenters with thin HTTP, Fresh, and component projections; verification and production build pass.
