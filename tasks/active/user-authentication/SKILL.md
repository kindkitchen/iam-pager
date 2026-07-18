---
name: user-authentication
description: Add interface-first request sessions and multi-strategy user authentication, beginning with cookie transport and Google OAuth through gauth 0.4.1. Load when working on sessions, request context, authentication, Google sign-in, logout, or authenticated navigation.
created: 2026-07-17
updated: 2026-07-18
tags: [authentication, sessions, backend, frontend]
relates: []
---

Active. Phase 1 and the provider-neutral phase-2 authentication core are
complete. Start/callback routes own bounded browser mapping and one-use state;
authenticated upgrades rotate the bearer and issue a 256-bit synchronizer token.
Bounded form-only logout validates repository state, atomically revokes access,
and centrally publishes a distinct fresh guest session and credential. No
provider strategy is registered yet.

Next: phase 3 from [[001.draft]] — pin gauth 0.4.1 and implement the Google
strategy adapter with explicit local/original preset composition and tests.
Mocked consent and header/navigation remain gated behind that provider work.
