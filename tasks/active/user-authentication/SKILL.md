---
name: user-authentication
description: Add interface-first request sessions and multi-strategy user authentication, beginning with cookie transport and Google OAuth through gauth 0.4.1. Load when working on sessions, request context, authentication, Google sign-in, logout, or authenticated navigation.
created: 2026-07-17
updated: 2026-07-18
tags: [authentication, sessions, backend, frontend]
relates: []
---

Active. Phase 1, route-independent authentication orchestration, and the generic
phase-2 start/callback HTTP boundary are complete. Thin Fresh routes now map
bounded browser requests to provider-neutral orchestration, return safe no-store
redirects/errors, omit secrets from diagnostics, and publish callback credential
rotation centrally without duplicate cookies. No provider strategy is registered
yet.

Next: add session-bound CSRF and `POST /auth/logout` with revocation and
fresh-guest establishment from [[001.draft]]. Google/gauth and header/navigation
work remain gated behind completed logout.
