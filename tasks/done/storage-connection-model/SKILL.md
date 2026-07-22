---
name: storage-connection-model
description: Completed step 4 of external-content-storage - per-user storage connections, same-account reauthorization, encrypted token custody, and conformant memory/Deno KV repositories. Load when extending storage connections or provider token persistence.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, storage]
relates: [external-content-storage, external-storage-provider-interface]
---

Implemented strict owner-safe connection metadata, one active connection per
creator/provider, retained revocation, same-subject reauthorization, and
provider-only credentials. Memory and Deno KV pass shared conformance; KV stores
separate connection-bound AES-256-GCM ciphertext and destroys it on revocation.

Verified with `deno task check` and all 607 tests. Next:
`google-drive-oauth-connection` populates this model.
