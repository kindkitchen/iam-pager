---
name: durable-storage
description: Add durable persistence behind existing repository interfaces with environment-selected backends. Load when implementing or reviewing storage adapters, persistence configuration, migration, or retention.
created: 2026-07-18
updated: 2026-07-18
tags: [backend, storage, persistence]
relates: [namespace-reservation-contracts]
---

Active. First vertical slice delivered: Deno KV adapters persist application
users, provider identities, and namespace reservations as one configurable
ownership backend; unset configuration keeps both reference memory
implementations. Shared conformance suites cover identity and namespace
contracts, and composition never permits durable claims with process-local owner
IDs. See [[005.summary]].

Content and sessions remain process-local. There is no backend migration,
application deletion/expiry, or application-managed backup. Next: select the
next repository by product need; evaluate content record sizing/chunking before
assuming one Deno KV value can preserve the existing `ContentRepository`
contract.
