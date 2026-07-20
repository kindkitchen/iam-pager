---
name: explicit-pre-deploy
description: Add an explicit Deno pre-deploy task graph and reusable forward-only, idempotent database-schema upgrade framework with a Deno KV adapter. Load when working on deployment gates, deno.json task dependencies, schema versions, or upgrade helpers.
created: 2026-07-20
updated: 2026-07-20
tags: [deployment, deno, storage, migrations, deno-kv]
relates: []
---

Active.

Next: implement the native Deno 2.9 task-object dependency graph, then the
interface-first forward-only schema runner and its Deno KV state/coordination
adapter. Verification runs in parallel; database upgrade is gated behind it and
repeated current-state runs are no-ops. See [[001.draft]], [[002.analysis]], and
[[003.log]].
