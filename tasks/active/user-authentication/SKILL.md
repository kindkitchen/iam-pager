---
name: user-authentication
description: Add interface-first request sessions and multi-strategy user authentication, beginning with cookie transport and Google OAuth through gauth 0.4.1. Load when working on sessions, request context, authentication, Google sign-in, logout, or authenticated navigation.
created: 2026-07-17
updated: 2026-07-18
tags: [authentication, sessions, backend, frontend]
relates: []
---

Active. Phase 1 and the first phase-2 slice are complete. The interface-first
session lifecycle uses independent opaque-cookie transport and process-local
storage; typed middleware preserves routed response semantics. Provider-neutral
identity/strategy contracts, atomic process-local identity persistence keyed by
stable provider subject, and a duplicate-safe multi-strategy registry are now
wired at composition.

Next: add bounded, session-owned OAuth attempts and the authentication service,
then generic start/callback/logout routes from [[001.draft]]. Google/gauth and
header/navigation work remain gated behind that core.
