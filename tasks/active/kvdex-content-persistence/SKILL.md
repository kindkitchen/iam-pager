---
name: kvdex-content-persistence
description: Implement the durable page/content/endpoint adapter with pinned Kvdex while preserving repository atomicity and migration safety. Load when working on Kvdex schemas, segmented PDF assets, endpoint indexes, or raw-Deno-KV compatibility.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, storage, deno-kv, kvdex, pdf]
relates: [content-endpoint-bindings, pdf-content-core, pdf-content-http]
---

Active, chain position 3 of 5. Verified immutable-asset staging is complete:
pinned Kvdex writes random-identity encoded payloads, verifies reconstruction,
length, SHA-256, and decoding, then publishes an unencoded manifest. Interrupted
known batches remain invisible and retryable; see [[004.summary]].

Next: implement unencoded page/endpoint/owner/public documents with one complete
conditional visibility commit and run unchanged aggregate conformance. Then add
explicit raw-keyspace compatibility/migration before deployment selection. The
raw Deno KV adapter remains selected.
