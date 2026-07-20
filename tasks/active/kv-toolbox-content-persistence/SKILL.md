---
name: kv-toolbox-content-persistence
description: Correct durable page/content persistence to use pinned kv-toolbox behind existing repository interfaces. Load when working on Deno KV adapters, blob staging, atomic page endpoints, legacy page migration, or removing Kvdex.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, storage, deno-kv, kv-toolbox, migration, pdf]
relates: [kvdex-content-persistence, content-endpoint-bindings, pdf-content-core, pdf-content-http]
---

Top priority, active, chain position 3 of 5. The rejected Kvdex prototype and
dependency are removed; `@kitsonk/kv-toolbox` 0.31.0 remains the required Deno
KV utility behind project-owned interfaces. Domain, application, HTTP, site,
deployment selection, schema versions, and production records are unchanged.

Phases 1 and 2 are complete; see [[008.summary]] and [[009.summary]]. Selected
record adapters use the gateway, segmented staging verifies reconstructed bytes,
and native invariant commits use `toolbox.db.atomic()`. The new immutable-asset
adapter snapshots input, encodes with `v8-1`, stages under random v1 payload
identities, verifies blob/length/SHA-256/codec/domain coherence, and publishes a
strict manifest with native CAS. Known losses clean staging; ambiguous commit
exceptions retain possibly referenced payloads. All 511 tests, tracked-source
checks, frozen dependency resolution, and build pass; unrelated untracked `.pi`
content remains untouched.

Next execute Phase 3 of [[004.plan]] as refined by [[006.decision]]: name the
aggregate repository capability and implement manifest-backed durable page,
endpoint-claim, owner, and public records with one native atomic visibility
commit. Run shared aggregate conformance plus durable restart, corruption,
contention, eight-endpoint, and transaction-headroom coverage before migration
or cutover. The raw Deno KV page adapter stays selected until all later gates
pass.
