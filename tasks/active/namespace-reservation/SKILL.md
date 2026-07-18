---
name: namespace-reservation
description: Reserve unique namespaces for authenticated creators and enforce publishing authorization (DS-PROTECT core). Load when working on namespace ownership, reservation, publish authorization, or protected-overwrite rules.
created: 2026-07-18
updated: 2026-07-18
tags: [backend, frontend, namespace, authorization, business-logic]
relates: [user-authentication, content-publishing, durable-storage]
---

Active; nothing implemented yet. This is the closest-to-business-logic slice:
it turns authentication (identity) and publishing (content) into ownership.

Scope and constraints in [[001.draft]]; sub-task plan S1-S7 in [[002.plan]].
Start with S1 (domain model and interfaces).

Persistence is intentionally in-memory behind repository interfaces; durable
backends are the queued `durable-storage` task, not this one.

The plan is a working assumption: the final implementation may change in
process, and when it does the specification changes with it in the same change
set (S7 owns that reconciliation).
