---
name: kvdex-content-persistence
description: Superseded Kvdex page/content persistence direction. Load only when tracing the rejected prototype or transferring its verified staging work to kv-toolbox.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, storage, deno-kv, kvdex, pdf]
relates: [kv-toolbox-content-persistence, content-endpoint-bindings, pdf-content-core, pdf-content-http]
---

Rejected and superseded by `kv-toolbox-content-persistence`; see [[005.log]].
No further Kvdex implementation should proceed.

The verified random-payload staging protocol, integrity checks, corruption
handling, and focused tests remain useful transfer inputs; see [[004.summary]].
The Kvdex-specific schema, encoding imports, and physical prefixes are not part
of the accepted direction. Deployment never selected this prototype, and the
raw Deno KV page adapter remains selected until its replacement passes the new
task's cutover gates.
