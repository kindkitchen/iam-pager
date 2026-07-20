---
name: kv-toolbox-content-persistence
description: Correct durable page/content persistence to use pinned kv-toolbox behind existing repository interfaces. Load when working on Deno KV adapters, blob staging, atomic page endpoints, legacy page migration, or removing Kvdex.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, storage, deno-kv, kv-toolbox, migration, pdf]
relates: [kvdex-content-persistence, content-endpoint-bindings, pdf-content-core, pdf-content-http]
---

Top priority, active, chain position 3 of 5. The Kvdex direction is rejected;
`@kitsonk/kv-toolbox` 0.31.0 is the required Deno KV utility. Domain,
application, HTTP, and site contracts remain unchanged.

Phase 1 is complete; see [[008.summary]]. The exact dependency is pinned behind
one project-owned gateway. Selected identity, namespace, session, legacy page,
and manual-schema adapters consume its record interface. Ordinary and segmented
binary operations delegate to `KvToolbox`; invariant-bearing commits use the
explicit native capability backed by `toolbox.db.atomic()`. Verified staging
fails closed on later-batch interruption or malformed/truncated state, including
at the 16 MiB PDF bound. The versioned `v8-1` codec matches the retained
prototype fixture. All 509 tests, check, and build pass.

Next replace the unselected Kvdex immutable-asset prototype with a gateway-backed
manifest adapter while preserving random staging, length/SHA-256/codec checks,
native CAS, ambiguous-outcome retention, and legacy-keyspace isolation. Remove
Kvdex only after equivalent fault coverage passes, then implement/migrate the
aggregate through [[004.plan]] as refined by [[006.decision]]. The raw Deno KV
page adapter stays selected until conformance, migration, and cutover gates pass.
