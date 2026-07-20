---
name: manual-schema-release-gate
description: Completed local push verification, read-only project/schema deployment gating, and explicit guarded remote database updates. Load when maintaining Git hooks, Deno Deploy release gates, database manifests, or schema updates.
created: 2026-07-20
updated: 2026-07-20
tags: [deployment, git-hooks, deno-kv, migrations, safety]
relates: [explicit-pre-deploy]
---

Blocked on live deployment confirmation.

Pre-deploy now permits Deno Deploy's injected remote KV path/token and dynamic
network endpoints; the manual updater permits metadata-selected data endpoints;
schema checks reject mixed memory/durable profiles. The selected dashboard setup
assigns all three backend selectors to All contexts: Build currently does not
compose storage, revision previews still force process memory, and Local uses
Deno KV only through `deno ... --tunnel`. All 475 tests, check, and build pass.
Next: rerun Deno Deploy and confirm a fresh timeline reaches `unversioned` or
`current`. See [[006.summary]], [[008.analysis]], and [[009.decision]].
