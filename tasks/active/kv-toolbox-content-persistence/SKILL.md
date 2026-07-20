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

Library assessment and the gated plan are complete; `deno task check` passes.
The completed staging protocol and tests are salvageable: random unreachable
payload, reconstruction plus length/SHA-256/codec verification, then one native
Deno KV manifest CAS. kv-toolbox blob operations replace only the physical
payload implementation. Native `Deno.Kv.atomic()` remains mandatory for
manifest and complete page/endpoint visibility because `KvToolbox.atomic()` may
split a commit.

Next: establish the storage-local blob/codec seams, replace the unselected asset
prototype without changing composition, then implement and migrate the aggregate
adapter through the gated plan in [[004.plan]]. The raw Deno KV page adapter
stays selected until conformance, migration, and cutover gates pass.
