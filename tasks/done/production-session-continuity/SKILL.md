---
name: production-session-continuity
description: Document the resolved production session-continuity configuration issue. Load when reviewing Deno KV backend selection, memory-backed deployment symptoms, or the deployment guidance.
created: 2026-07-19
updated: 2026-07-19
tags: [authentication, sessions, production, storage]
relates: [user-authentication, durable-storage, namespace-reservation-http, page-management-api]
---

Resolved as deployment configuration and expectation, not an application-logic defect. Attaching Deno KV only makes a database available; production must explicitly select Deno KV for ownership, sessions, and pages. Unset or explicit `memory` remains legitimate for a single local process but is not request-stable on a serverless preview.

README and the session specification now document environment-scoped production, preview, and local profiles plus the characteristic sign-in-to-guest failure mode. No application behavior changed.
