---
name: kv-toolbox-content-persistence
description: Correct durable page/content persistence to use pinned kv-toolbox behind existing repository interfaces. Load when reviewing Deno KV aggregate storage, migration, readiness-gated v2 selection, or the retained v1 fallback.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, storage, deno-kv, kv-toolbox, migration, pdf]
relates: [kvdex-content-persistence, content-endpoint-bindings, pdf-content-core, pdf-content-http]
---

Complete, chain position 3 of 5. Pinned kv-toolbox is isolated behind the project
gateway; immutable assets and complete page aggregates persist in adjacent
strict keyspaces with native atomic visibility. The retained manual migration is
source-preserving, deterministic, repeat-safe, and guarded by a source-bound
readiness probe.

Explicit `deno-kv-v2` composition now selects the named aggregate interface only
after that probe passes. `deno-kv` retains the untouched schema-v1 compatibility
and fallback path; memory, identity, namespace, and session composition remain
unchanged. All 543 tests, tracked-source checks, the production build, and a
disposable manual schema release pass. PDF HTTP work is unblocked. See
[[012.summary]] and [[013.log]].
