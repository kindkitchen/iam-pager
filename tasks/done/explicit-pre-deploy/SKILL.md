---
name: explicit-pre-deploy
description: Implemented the explicit Deno pre-deploy task graph and reusable forward-only, idempotent database-schema upgrade framework with a Deno KV adapter. Load when changing deployment gates, schema versions, upgrade helpers, or Deno KV upgrade coordination.
created: 2026-07-20
updated: 2026-07-20
tags: [deployment, deno, storage, migrations, deno-kv]
relates: []
---

Done.

`deno task pre-deploy` runs check/test/build in parallel and gates the uncached
schema command behind all three. The interface-first runner preflights immutable
adjacent plans, resumes exact idempotent claims, and fails closed; Deno KV
provides versionstamped state for `ownership`, `sessions`, and `pages`. Missing
metadata is baseline version 1 and current runs are no-change. Helpers must also
be concurrency-safe because a pending claim is resumable, not a process mutex.
All 454 tests, check, build, repeated schema tasks, and the full gate pass. See
[[004.summary]] and [[005.log]].
