---
name: user-authentication
description: Add interface-first request sessions and multi-strategy user authentication, beginning with cookie transport and Google OAuth through gauth 0.4.1. Load when working on sessions, request context, authentication, Google sign-in, logout, or authenticated navigation.
created: 2026-07-17
updated: 2026-07-18
tags: [authentication, sessions, backend, frontend]
relates: []
---

Active. Phase 1 is complete: the session lifecycle, process-local repository,
explicit production/local opaque cookie transport, typed request context, and
root Fresh middleware are implemented. Every application-routed request now has
a unique server-owned request ID and guest/authenticated session; response
status/body/length and direct-content isolation remain intact.

Next: begin phase 2 with provider-neutral identity models, an interface-backed
memory repository, and the multi-strategy registry. Then add bounded OAuth
attempt orchestration and generic auth routes in [[001.draft]] before Google or
header/navigation work.
