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
single key-accessible operation ([[004.log]]). The web projection is live at
`/site/api-keys`: presenter and request builders in
`lib/ui/api-key-panel.ts`, island with generate/copy-once/edit/revoke/
revoke-all UX ([[005.log]]). Durable persistence is done: shared repository
conformance suite, `DenoKvApiKeyRepository` with owner-generation revoke-all,
and the `IAM_PAGER_API_KEY_STORAGE_BACKEND` factory inheriting durable
ownership ([[006.log]]). Bearer authorization is live: `lib/api-auth/`
resolves guest/browser/key principals, the permission matrix guards every
page and namespace operation, and bearer requests get an ephemeral guest
view with no cookie issuance or fallback ([[007.log]]).

Next from [[003.plan]]: link 1 specification documents, link 7 closure.
