---
name: storage-composition
description: How repository backends are selected and why selection fails closed. Load when changing storage configuration, Deno KV wiring, or investigating lost page state.
updated: 2026-07-23
sources: [alias-storage-data-loss]
---

Repository backends are chosen by explicit `IAM_PAGER_*_STORAGE_BACKEND`
selectors. Configured service composition requires ownership, session, and page
backends to be set explicitly and fails closed otherwise — an unset selector must
never silently mean process memory. `deno task dev` chooses memory explicitly.

- `IAM_PAGER_CONTENT_STORAGE_BACKEND` remains accepted as a compatible alias of
  the page selector; supplying both with conflicting values fails.
- Dependent selectors (session, page, API key, storage connections) require
  durable ownership and inherit its KV path.
- `DENO_KV_ID` and `DENO_KV_ACCESS_TOKEN` are Deno KV connection hints, **not**
  repository selectors. `Deno.openKv()` without an explicit remote URL does not
  use them locally. Remote CLI access needs the complete connect URL in
  `IAM_PAGER_OWNERSHIP_DENO_KV_PATH`.

Why: a deployment lost pages after an alias change. Alias mutation was
exonerated — reference updates preserve `content_asset_id` and commit the
aggregate and endpoint projections atomically, proven by a Deno KV regression
that adds an alias, reconstructs the repository, and re-reads page, alias, and
immutable asset. The real cause was memory-backed page state surviving only
inside one isolate, exposed on restart. Data lost with a memory process is not
recoverable.

Renaming a documented storage selector without a compatibility path is therefore
a data-loss change, not a rename.
