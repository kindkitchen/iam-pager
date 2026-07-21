---
name: api-keys
description: Specification-first API keys and a permission-aware API principal — complete. Load only for history on API-key lifecycle, bearer authentication, API authorization, or the key-management UI.
created: 2026-07-21
updated: 2026-07-22
tags: [authentication, api, security]
relates: []
---

Complete. The full chain shipped: `lib/api-key/` lifecycle with memory and
Deno KV persistence behind one conformance suite ([[004.log]], [[006.log]]),
browser-owned management HTTP at `/api/api-keys[/:id]` with bearer revoke-all
as the single key-accessible operation, the `/site/api-keys` projection
([[005.log]]), and `lib/api-auth/` bearer principals authorizing every page
and namespace operation with no cookie fallback or issuance ([[007.log]]).
Closure ([[008.log]]): specification sections (`SA-APIKEY`, `CP-APIKEY`,
`CP-API-AUTH`, `EX-AUTOMATE`, updated QT/PD/OS/SP), `docs/api/authentication.md`
with the full permission matrix, README bearer usage and security warning, and
the endpoint × principal contract-matrix test
(`lib/api-contract-matrix.test.ts`). All gates pass.
