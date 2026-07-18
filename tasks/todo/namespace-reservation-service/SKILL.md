---
name: namespace-reservation-service
description: Step 2 of the namespace-reservation direction (DS-PROTECT) - reservation service with locator-engine validity plus publishing authorization. Load when working on namespace ownership business logic.
created: 2026-07-18
updated: 2026-07-18
tags: [backend, namespace, business-logic]
relates: [namespace-reservation-contracts, durable-storage]
---

Todo, not started. Build the business core on the step-1 contracts: a
reservation service (validate namespace via the locator engine, reserve via
`NamespaceRepository`, list owned namespaces) and publishing authorization
enforcing the DA-NAMESPACE table - guest and cross-user writes rejected in
reserved namespaces, owner allowed, unreserved namespaces keep current
behavior. No HTTP concepts; step 3 adds API + site surfaces.
