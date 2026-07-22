---
name: google-drive-oauth-connection
description: Step 5 of external-content-storage - Google Drive OAuth connect/disconnect flow reusing @kindkitchen/gauth with its own explicit registration (separate client, redirect URIs, Drive scopes) and a local mock consent mode. Load when working on Drive OAuth or storage connect routes.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, auth, google-drive]
relates: [external-content-storage, storage-connection-model]
---

Second, explicit gauth registration - storage consent is NOT sign-in. Own env
namespace `IAM_PAGER_GOOGLE_DRIVE_*` (client id/secret, redirect uri, mode,
mock consent url), own callback route, minimal scope (`drive.file`), offline
access for refresh tokens.

Deliverables:
- `lib/external-storage/google-drive-oauth-composition.ts` mirroring
  `lib/auth/google-gauth-composition.ts` (local/original modes, host
  pattern, mock consent reuse).
- Connect flow: authenticated creator -> consent -> callback validates state,
  exchanges code, stores/refreshes a `StorageConnection` + credentials.
- Disconnect flow: revoke token at Google, mark connection revoked.
- Routes under `routes/auth/storage/google-drive/` (start, callback,
  disconnect); session required; CSRF-safe state handling.
- Local mock mode so the whole flow runs offline in tests.

Depends on: storage-connection-model.
Next after done: google-drive-provider consumes stored credentials.
