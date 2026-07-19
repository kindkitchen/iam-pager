---
name: page-management-api
description: Deliver API-first core page management for authenticated creators, including explicit create/list/inspect/update/access/delete contracts and private direct delivery. Load when working on managed pages, page persistence, page APIs, or delivery authorization.
created: 2026-07-19
updated: 2026-07-19
tags: [api, backend, security, storage]
relates: []
---

Active; implementing the plan in `003.plan.md`, currently at step 1
(documentation correction and contract fixtures).

The specification already fixes the product boundary: creators manage default
and named pages in reserved namespaces; managed pages can be public or private;
private direct requests look missing to non-owners; guests publish only public
trial content without guarantees. The next task implements the DS-PROTECT core
through interface-backed application services and an explicit HTTP API. UI is
not an acceptance source and receives only minimal compatibility wiring.

The planned API creates managed resources, lists and inspects owner-visible
source, atomically patches content/access with revisions, and deletes. Stable
opaque page IDs keep management identity independent from renameable direct
locators. Trial writes can replace only trial pages; managed creation replaces a
trial at its locator; no trial write can replace a managed page.

No production-data migration or legacy API compatibility is required. Rename,
duplicate, bulk actions, tags, filters beyond namespace, search, and management
UI remain later DS-MANAGE work, but the page ID/revision contracts are designed
to extend to them.

Baseline before implementation: `deno task check` and all 307 tests pass.
Next: follow the plan's implementation sequence in order, keeping checks and
tests green at each step.
