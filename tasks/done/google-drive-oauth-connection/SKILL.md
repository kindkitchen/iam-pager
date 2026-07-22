---
name: google-drive-oauth-connection
description: Completed Google Drive storage OAuth connect/disconnect flow with separate gauth registration, encrypted credential persistence, and offline local mock. Load when revisiting Drive consent or storage connection routes.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, auth, google-drive]
relates: [external-content-storage, storage-connection-model]
---

Implemented under `lib/external-storage/` and
`routes/auth/storage/google-drive/`. Storage consent remains separate from
sign-in, binds one-use hashed state to an authenticated user/session, requests
offline `drive.file` consent, and creates or reauthorizes encrypted connection
credentials. CSRF-protected disconnect revokes locally even when Google is
unavailable. Memory/Deno KV composition, allowlisted dynamic callbacks, and a
full local mock roundtrip are tested; final verification passes 621 tests (13
steps).

Next: `google-drive-provider` consumes stored credentials.
