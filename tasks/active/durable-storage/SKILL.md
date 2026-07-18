---
name: durable-storage
description: Add durable persistence behind existing repository interfaces with environment-selected backends. Load when implementing or reviewing storage adapters, persistence configuration, migration, or retention.
created: 2026-07-18
updated: 2026-07-18
tags: [backend, storage, persistence]
relates: [namespace-reservation-contracts]
---

Active. Two vertical slices are delivered. Deno KV adapters persist users,
provider identities, namespace reservations, and optionally sessions; unset
configuration keeps every reference memory implementation. Durable sessions are
allowed only with durable ownership and inherit its database, while durable
ownership may still use restart-invalidated memory sessions. Shared conformance
suites cover every implemented adapter. See [[005.summary]], [[006.decision]],
[[007.summary]], and [[008.review]].

Ownership records still have no application deletion/expiry, while session
records follow their bounded lifecycle and absolute-lifetime KV TTL. There is no
backend migration or application-managed backup. Content remains process-local.
Next: settle a chunked immutable-generation layout that preserves atomic
`ContentRepository` replacement when source plus derived output exceeds one KV
value, then implement and compose the adapter.
