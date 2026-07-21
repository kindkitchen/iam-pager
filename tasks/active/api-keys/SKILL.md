---
name: api-keys
description: Add specification-first API keys and a permission-aware API principal. Load when defining or implementing API-key lifecycle, bearer authentication, API authorization, or the secondary key-management UI.
created: 2026-07-21
updated: 2026-07-22
tags: [authentication, api, security]
relates: []
---

Core lifecycle is implemented: `lib/api-key/` owns model, service, memory
repository, ETags, and the HTTP adapter; thin routes live at
`/api/api-keys[/:id]` and the wire contract is `docs/api/api-keys.md`.
Browser owners manage keys (CSRF + strong If-Match); the one-time
`iamp_` bearer is hash-only at rest; bearer revoke-all with `delete` is the
single key-accessible operation ([[004.log]]).

Next from [[003.plan]]: link 1 specification documents, link 3 Deno KV
repository + conformance + storage factories, link 5 API principal resolver
over page/namespace operations, link 6 web projection, link 7 closure.
