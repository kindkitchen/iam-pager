---
name: namespace-reservation-http
description: Step 3/4 of the namespace-reservation direction (DS-PROTECT) - authenticated HTTP API, creator site panel, actor wiring, and conformance/docs. Done; load when reviewing the reservation web surface.
created: 2026-07-18
updated: 2026-07-18
tags: [backend, frontend, namespace, http]
relates: [namespace-reservation-service, namespace-reservation-contracts]
---

Done. `NamespaceHttpHandler` exposes authenticated listing and bounded,
CSRF-protected reservation over `/api/namespaces`; a server presenter supplies
the creator-only site panel with owned claims, paths, timestamps, and trusted
form input. `/api/pages` derives its actor from the resolved session, allowing
owners while preserving guest/cross-creator rejection. Responses and failures
are typed and no-store; ordering is deterministic. README and QT-API are current.
See [[002.summary]]. All 307 tests, checks, and production build pass.

Remaining DS-PROTECT work is creator page management/access, outside this task.
