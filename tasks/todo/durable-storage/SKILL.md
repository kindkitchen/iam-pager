---
name: durable-storage
description: Queued on purpose - durable persistence behind the existing repository interfaces with switchable backends (Postgres, MongoDB, Deno KV, ...). Load when persistence work unblocks or a backend choice comes up.
created: 2026-07-18
updated: 2026-07-18
tags: [backend, storage, backlog]
relates: [namespace-reservation-contracts]
---

Queued deliberately: waits for the namespace contracts (active task) to settle
the newest repository contract and its conformance suite.

The in-memory repositories are the first legitimate implementation, not mocks
— acceptable in production while the product is in development, because
durability is an environment concern. Durable backends arrive later as
switchable implementations selected at the composition root; services never
change. "How" is fixed in [[001.draft]]; "what exactly" stays open.
