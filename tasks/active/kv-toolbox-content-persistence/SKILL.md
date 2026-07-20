---
name: kv-toolbox-content-persistence
description: Correct durable page/content persistence to use pinned kv-toolbox behind existing repository interfaces. Load when working on Deno KV adapters, blob staging, atomic page endpoints, legacy page migration, controlled durable cutover, or removing Kvdex.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, storage, deno-kv, kv-toolbox, migration, pdf]
relates: [kvdex-content-persistence, content-endpoint-bindings, pdf-content-core, pdf-content-http]
---

Top priority, active, chain position 3 of 5. Phases 1-4 are complete; see
[[008.summary]], [[009.summary]], [[010.summary]], and [[011.summary]]. The
rejected Kvdex dependency is gone. Pinned kv-toolbox is isolated behind the
project gateway; immutable assets and complete page aggregates persist in
adjacent strict keyspaces with native atomic visibility.

The retained `pages-v1-to-v2` manual migration validates the complete visible v1
source, derives deterministic retry-safe asset/payload identities, conditionally
imports and verifies exact v2 state, leaves every v1 key untouched, and publishes
a source-bound readiness record. Its probe refuses missing, changed, corrupt,
conflicting, or incomplete migration state, including a source write racing
readiness publication. All 542 tests, tracked-source checks, and the production
build pass.

Next execute Phase 5 of [[004.plan]]: make explicit durable composition select
the named v2 aggregate interface only after the readiness probe passes. Preserve
the legacy compatibility/fallback path, keep identity/namespace/session
composition unchanged, and prove shared database selection plus unchanged
service, HTTP, presenter, route, and component behavior. Do not delete v1 data,
automate migration at startup/deploy, or begin PDF transport before the cutover
gate passes.
