---
name: manual-schema-release-gate
description: Completed local push verification, read-only project/schema deployment gating, and explicit guarded remote database updates. Load when maintaining Git hooks, Deno Deploy release gates, database manifests, or schema updates.
created: 2026-07-20
updated: 2026-07-20
tags: [deployment, git-hooks, deno-kv, migrations, safety]
relates: [explicit-pre-deploy]
---

Done.

Local Git/GitButler pushes run the native verification hook; deployment only
reads an exact project/version manifest; developers run guarded remote updates
with explicit URL, token, project, and complete version vectors. Revision
previews force memory storage, while durable review uses isolated Git branch
timelines. Version 0 means an absent manifest, never a wildcard. See
[[003.summary]] for the completed design and verification.
