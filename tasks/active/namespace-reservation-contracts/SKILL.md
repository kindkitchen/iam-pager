---
name: namespace-reservation-contracts
description: Step 1 of the namespace-reservation direction (DS-PROTECT) - namespace model, repository contract, in-memory implementation, conformance suite. Load when working on namespace ownership foundations.
created: 2026-07-18
updated: 2026-07-18
tags: [backend, namespace, business-logic]
relates: [durable-storage]
---

Active, not started. Deliver `lib/namespace/`: reservation model, repository
contract (atomic reserve, case-insensitive uniqueness, supplied casing
preserved), in-memory implementation, and a reusable conformance suite.

Direction has four steps, one task at a time; the next task is created when
the previous completes: 1 contracts (this), 2 reservation service + publishing
authorization, 3 API + site surfaces, 4 conformance check + docs.

The whole direction runs to completion on the in-memory implementation; no
step may depend on a concrete backend. Durable backends from `durable-storage`
swap in later behind the same contract with no changes to any step's code.

Specification has priority: implementation diverging from the spec is rejected
early; direction changes update the spec first, then implementation continues.
