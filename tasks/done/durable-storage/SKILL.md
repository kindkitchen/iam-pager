---
name: durable-storage
description: Add durable persistence behind existing repository interfaces with environment-selected backends. Load when reviewing how storage adapters, persistence configuration, or retention were delivered.
created: 2026-07-18
updated: 2026-07-18
tags: [backend, storage, persistence]
relates: [namespace-reservation-contracts]
---

Done. Three vertical slices delivered Deno KV adapters behind every repository
interface: users and provider identities, namespace reservations, sessions, and
page content. Unset configuration keeps every reference memory implementation.
Durable sessions and durable content each require durable ownership and inherit
its database. Content uses an envelope plus immutable generation chunks with
atomic replacement ([[009.decision]]). Shared conformance suites cover every
adapter. See [[005.summary]], [[007.summary]], and [[010.summary]].

Out of scope, documented as operational limits: ownership expiry/deletion,
backend migration, application-managed backup, and an orphan-chunk sweeper.
