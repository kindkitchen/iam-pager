---
name: user-authentication
description: Add interface-first request sessions and multi-strategy user authentication, beginning with cookie transport and Google OAuth through gauth 0.4.1. Load when working on sessions, request context, authentication, Google sign-in, logout, or authenticated navigation.
created: 2026-07-17
updated: 2026-07-18
tags: [authentication, sessions, backend, frontend]
relates: []
---

Active. Phase 1 and the route-independent phase-2 core are complete. The
interface-first session lifecycle, typed request middleware, provider-neutral
identity/strategy contracts, atomic process-local repositories, and
multi-strategy registry are wired at composition. Guest sessions now own
bounded, expiring attempts with hashed one-use state, and the authentication
orchestrator consumes callbacks before provider exchange, saves stable identity,
and upgrades the logical session with bearer rotation.

Next: add generic start/callback HTTP adapters and CSRF-protected logout with
fresh-guest establishment from [[001.draft]]. Google/gauth and header/navigation
work remain gated behind those routes.
