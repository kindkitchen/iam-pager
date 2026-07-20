---
name: kv-toolbox-content-persistence
description: Correct durable page/content persistence to use pinned kv-toolbox behind existing repository interfaces. Load when working on Deno KV adapters, blob staging, atomic page endpoints, legacy page migration, or removing Kvdex.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, storage, deno-kv, kv-toolbox, migration, pdf]
relates: [kvdex-content-persistence, content-endpoint-bindings, pdf-content-core, pdf-content-http]
---

Top priority, active, chain position 3 of 5. The rejected Kvdex prototype and
dependency are removed; `@kitsonk/kv-toolbox` 0.31.0 remains isolated behind the
project gateway. Domain, HTTP, site, deployment selection, schema registry, and
production records remain unchanged.

Phases 1-3 are complete; see [[008.summary]], [[009.summary]], and
[[010.summary]]. `PageAggregateRepository` now names the complete split
capability. Its durable implementation composes strict v1 asset manifests with
adjacent v2 page envelopes, revision-bearing case-normalized endpoint claims,
and ordered owner/public projections. Every visibility mutation uses one native
atomic commit, retries conditional losses 16 times, and leaves immutable assets
intact. Shared conformance, restart, corruption, manifest, contention,
eight-endpoint, and worst-case 87-of-100-check coverage pass. All 533 tests,
tracked-source formatting/lint/type checks, frozen dependency resolution, and
the production build pass; unrelated untracked `.pi` content remains untouched.

Next execute Phase 4 of [[004.plan]]: add one manual, adjacent, repeat-safe,
source-preserving `pages-v1-to-v2` migration, deterministic retry-safe asset
identities, conflict/corruption fixtures, and an explicit readiness refusal for
unmigrated non-empty v1 storage. Do not select the v2 adapter, mutate v1 records,
or change startup/deploy behavior before the migration gate passes.
