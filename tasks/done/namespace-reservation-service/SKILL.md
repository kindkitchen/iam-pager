---
name: namespace-reservation-service
description: Step 2 of the namespace-reservation direction (DS-PROTECT) - reservation service with locator-engine validity plus publishing authorization. Done; load only for history of the namespace business layer.
created: 2026-07-18
updated: 2026-07-18
tags: [backend, namespace, business-logic]
relates: [namespace-reservation-contracts, durable-storage]
---

Done. `NamespaceReservationService` (behind `NamespaceReservationManager`)
validates namespaces through the locator engine with typed
`invalid_namespace`/`forbidden_namespace`/`taken` results and lists owned
reservations; `NamespacePublishingAuthorizer` enforces the DA-NAMESPACE
table inside `PublishingService` via `PublishActor` (absent = guest) with
typed `namespace_reserved` (403 on the guest API), while `ContentRepository`
stays protection-free. Wired in the composition root; 17 tests; delivery
recorded in [[003.log]].

Direction continues with step 3 (HTTP API + site UI for reservation, not yet
a task) and step 4 (conformance check + docs).
