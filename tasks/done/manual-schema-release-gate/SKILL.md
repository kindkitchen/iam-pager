---
name: manual-schema-release-gate
description: Completed simplification of database release health into explicit developer tasks while deploy remains a no-op. Load when maintaining schema checks, updates, runtime storage selection, or deployment wiring.
created: 2026-07-20
updated: 2026-07-20
tags: [deployment, git-hooks, deno-kv, migrations, safety]
relates: [explicit-pre-deploy]
---

Completed the release-path simplification.

Pre-deploy is a permissionless echo; deploy/startup have no database gate.
`db:check` and confirmed `db:update` now provide explicit-target, actionable
manual health work over one compatible manifest and repeat-safe migration
registry. Runtime no longer rewrites storage by timeline, while record-level
schema validation remains. All 446 tests, check, and production build pass.
See [[011.summary]] for the resulting contracts and removed machinery.
