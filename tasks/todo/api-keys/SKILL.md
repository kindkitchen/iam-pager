---
name: api-keys
description: Add specification-first API keys and a permission-aware API principal. Load when defining or implementing API-key lifecycle, bearer authentication, API authorization, or the secondary key-management UI.
created: 2026-07-21
updated: 2026-07-21
tags: [authentication, api, security]
relates: []
---

Specification-first implementation chain for owner API keys. Browser-authenticated
users manage their own keys; bearer-authenticated requests can exercise granted
owner API capabilities but cannot manage individual keys. A granted delete
capability permits atomic revoke-all, including the calling key.

The accepted direction is a distinct API principal/policy boundary, not treating
an API key as a browser `Session` or another `SessionTransport`.

Next: complete chain link 1 in [[003.plan]] and freeze the final behavior in the
specification and API references before changing implementation.
