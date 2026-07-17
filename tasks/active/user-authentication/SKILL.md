---
name: user-authentication
description: Add interface-first request sessions and multi-strategy user authentication, beginning with cookie transport and Google OAuth through gauth 0.4.1. Load when working on sessions, request context, authentication, Google sign-in, logout, or authenticated navigation.
created: 2026-07-17
updated: 2026-07-17
tags: [authentication, sessions, backend, frontend]
relates: []
---

Active. The transport-independent session lifecycle is implemented with hashed
bearer lookup, guest/authenticated state, bounded renewal, atomic upgrade and
credential rotation, revocation, process-local storage, and focused concurrency
coverage. `auth` is now a reserved route namespace.

Next: finish phase 1 with explicit local/production cookie transport, root Fresh
request middleware, typed request context, and response-preservation tests. Then
continue phases 2–5 in [[001.draft]] before any header/navigation work.
