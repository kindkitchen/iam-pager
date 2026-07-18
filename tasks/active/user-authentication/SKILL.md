---
name: user-authentication
description: Add interface-first request sessions and multi-strategy user authentication, beginning with cookie transport and Google OAuth through gauth 0.4.1. Load when working on sessions, request context, authentication, Google sign-in, logout, or authenticated navigation.
created: 2026-07-17
updated: 2026-07-18
tags: [authentication, sessions, backend, frontend]
relates: []
---

Active. Phases 1 and 2 are complete. gauth 0.4.1 and compatible Effect are
pinned, and the thin Google adapter now passes exact authorization inputs, keeps
only the PKCE verifier as server-side attempt context, maps verified profile
fields, discards provider tokens, and hides provider failures. All 153 tests
pass. No provider strategy is registered yet; see [[010.summary]].

Next: finish phase 3 with startup-validated configuration and explicit
local/original preset composition, register Google, and test both modes without
network access or secrets. Mocked consent and header/navigation remain gated.
