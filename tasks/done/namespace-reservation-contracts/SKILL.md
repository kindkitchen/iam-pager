---
name: namespace-reservation-contracts
description: Step 1 of the namespace-reservation direction (DS-PROTECT) - namespace model, repository contract, in-memory implementation, conformance suite. Done; load only for history of the namespace contract layer.
created: 2026-07-18
updated: 2026-07-18
tags: [backend, namespace, business-logic]
relates: [durable-storage, namespace-reservation-service]
---

Done. `lib/namespace/` delivers the reservation model, the
`NamespaceRepository` contract (atomic reserve with exactly one concurrent
winner and typed `taken`, case-insensitive identity via the locator key,
supplied casing preserved), the in-memory implementation, and the
implementation-agnostic conformance suite that `durable-storage` backends
reuse unchanged. 9 tests; delivery recorded in [[002.log]].

Direction continues with step 2 in `namespace-reservation-service`
(reservation service + publishing authorization).
