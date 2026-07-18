---
name: durable-storage
description: Deliberately queued backlog task - durable persistence behind the existing repository interfaces with switchable backends (Postgres, MongoDB, Deno KV, ...). Load when persistence work unblocks or a storage backend choice comes up.
created: 2026-07-18
updated: 2026-07-18
tags: [backend, storage, architecture, backlog]
relates: [namespace-reservation, content-publishing, user-authentication]
---

Queued on purpose, not forgotten — see [[001.draft]] for why the queueing is
itself the plan. Waits for `namespace-reservation` to settle the newest
persistence surface (ownership) before any backend work starts.

Position: persistence is an environment concern. The in-memory repositories are
the first real implementation, not mocks, and are acceptable in production
while the whole product is in development. Durability arrives as additional
switchable implementations (Postgres, MongoDB, Deno KV, ...) selected at the
composition root — never as a redesign of services.

"What exactly" (which repository first, which backend first, migration,
retention) is deliberately undecided; the "how" constraints are fixed in
[[001.draft]].
