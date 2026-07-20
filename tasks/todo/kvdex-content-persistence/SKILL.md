---
name: kvdex-content-persistence
description: Implement the durable page/content/endpoint adapter with pinned Kvdex while preserving repository atomicity and migration safety. Load when working on Kvdex schemas, segmented PDF assets, endpoint indexes, or raw-Deno-KV compatibility.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, storage, deno-kv, kvdex, pdf]
relates: [content-endpoint-bindings, pdf-content-core, pdf-content-http]
---

Todo, chain position 3 of 5. Blocked by `content-endpoint-bindings` and
`pdf-content-core` contracts.

Kvdex is an adapter detail, not a new product or service boundary. It may replace
the raw Deno KV page/content implementation only after shared conformance,
crash/partial-write safety, and existing-keyspace compatibility are proven. It
persists explicit endpoint locator/profile bindings and never derives paths from
PDF; see [[001.draft]] and [[002.decision]].
