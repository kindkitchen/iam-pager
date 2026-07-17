---
name: user-authentication
description: Add interface-first request sessions and multi-strategy user authentication, beginning with cookie transport and Google OAuth through gauth 0.4.1. Load when working on sessions, request context, authentication, Google sign-in, logout, or authenticated navigation.
created: 2026-07-17
updated: 2026-07-17
tags: [authentication, sessions, backend, frontend]
relates: []
---

Planned and ready to implement. Every routed application request must receive a
request ID and a server-side guest or authenticated session; cookies carry only
an opaque credential.

Next: complete phases 1–5 in [[001.draft]] and pass the core gate. Only then
start the lower-priority authenticated header/navigation work.
