---
name: user-authentication
description: Add interface-first request sessions and multi-strategy user authentication, beginning with cookie transport and Google OAuth through gauth 0.4.1. Load when working on sessions, request context, authentication, Google sign-in, logout, or authenticated navigation.
created: 2026-07-17
updated: 2026-07-18
tags: [authentication, sessions, backend, frontend]
relates: []
---

Active. Phases 1 and 2 are complete. Phase 3 now includes validated explicit
local/original gauth 0.4.1 composition, Google registration, and the
package-rendered development consent route. The complete local browser flow
preserves the logical session, upgrades it, rotates its bearer, and rejects the
stale guest credential. All 161 tests pass without network access or real
credentials; see [[010.summary]], [[011.log]], and [[012.log]].

Next: add guest sign-in and authenticated session actions to the site
header/navigation, keeping session and authorization decisions outside UI
components.
