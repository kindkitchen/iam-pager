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
All KV access will pass through a project-owned storage interface backed by
`KvToolbox`; the concrete wrapper cannot leak beyond its infrastructure
implementation. Ordinary/blob calls delegate to the toolbox, while the
interface's native-atomic capability delegates to `toolbox.db.atomic()` because
`KvToolbox.atomic()` may split a commit. See [[006.decision]].

The completed random-stage, length/SHA-256/codec verification, and native
manifest-CAS protocol remains salvageable. Ready for development; see
[[007.review]]. First implement and contract-test the KV gateway and codec seam,
then replace the unselected asset prototype and implement/migrate the aggregate
adapter through [[004.plan]] as refined by [[006.decision]]. The raw Deno KV page adapter
stays selected until conformance, migration, and cutover gates pass.
