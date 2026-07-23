---
name: alias-storage-data-loss
description: Prevent pages or assets from disappearing after reference-alias changes and make accidental volatile storage configuration visible. Load when investigating page persistence, alias mutation, or Deno KV runtime selection.
created: 2026-07-23
updated: 2026-07-23
tags: [pages, persistence, deno-kv]
relates: []
---

Completed. Alias updates atomically retain immutable assets; Deno KV reconstruction coverage proves it. The loss came from page/asset process memory: Deno KV connection hints are not repository selectors, and a renamed page selector could silently disable durable pages.
Configured runtimes now require explicit ownership/session/page backends, the old page selector remains compatible, conflicts fail closed, and remote-KV setup is documented. Audited remote and local KV databases contain no recoverable page or asset records. Verification and production build pass.
