---
name: public-view-capability
description: DS-VIEW site-mediated viewing through a pure-logic public view contract and thin `/site/<locator>` wrapper. Load when reviewing public wrapped viewing, namespace public listings, creator default/other-page links, or visitor visibility rules.
created: 2026-07-19
updated: 2026-07-19
tags: [backend, frontend, delivery]
relates: [creator-management-ui, public-exploration]
---

Done. Chain position 2 of 4; `public-exploration` can now reuse the delivered
public-listing primitive and wrapped-view destination.

DS-VIEW is implemented end to end: HTTP-independent public page viewing and
bounded namespace listing; memory and Deno KV conformance; visitor-safe
summaries; default and other-public-page links; sandboxed HTML preview with
fallback; trial exclusion from listings; and non-disclosing 404 behavior for
private or missing wrapped views at `/site/<locator>`.

Specs, README, CHANGELOG, and open-question decisions are current. Verification:
371 tests, check, build, and a composed public/missing HTTP smoke green.
Completion record: [[003.log]]. Original
scope and invariants: [[001.draft]].
