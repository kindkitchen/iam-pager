---
name: public-exploration
description: Completed DS-EXPLORE first version - public browse and namespace/page-name search with strict private/guest exclusion. Load when maintaining exploration or adding tags/indexed search.
created: 2026-07-19
updated: 2026-07-19
tags: [backend, frontend, search]
relates: [public-view-capability, management-expansion]
---

Completed chain position 3 of 4: deterministic browse plus case-insensitive
namespace/page-name substring search over public managed pages. Query-bound
cursor pagination and strict private/guest exclusion conform on memory and Deno
KV; `/` and `/site` project the contract into DS-VIEW and direct links.

OQ-EXPLORE is settled for this slice. `management-expansion` adds tags next;
text indexing, relevance, and view-count sorting remain deferred. Verification:
check, all 384 tests, and build pass. See [[004.summary]].
