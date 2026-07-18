---
name: user-authentication
description: Add interface-first request sessions and multi-strategy user authentication, beginning with cookie transport and Google OAuth through gauth 0.4.1. Load when working on sessions, request context, authentication, Google sign-in, logout, or authenticated navigation.
created: 2026-07-17
updated: 2026-07-18
tags: [authentication, sessions, backend, frontend]
relates: []
---

Active. Phases 1 and 2 are complete. Phase 3 now validates explicit local or
original Google configuration, loads only the selected gauth 0.4.1 preset,
registers `GoogleGAuthStrategy`, and keeps local fake auth on a same-origin
loopback callback/consent pair. All 157 tests pass without network access or
real credentials; see [[010.summary]] and [[011.log]].

Next: add the development-only package-rendered mock consent route and test the
complete local start/callback/session-upgrade browser flow. Header/navigation
remain gated behind that verified flow.
