---
name: google-drive-provider
description: Step 6 of external-content-storage - Google Drive implementation of ExternalStorageProvider (fetch/stat/put, token refresh, error mapping) passing the conformance suite. Load when working on Drive API calls or the drive provider adapter.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, google-drive]
relates:
  [
    external-content-storage,
    external-storage-provider-interface,
    google-drive-oauth-connection,
  ]
---

First concrete provider: `lib/external-storage/google-drive-provider.ts`,
`provider_id: "google-drive"`, capabilities `read`, `stat`, `write`. Consumes
credentials via the connection repository; refreshes access tokens; maps
Drive API responses to the interface failure taxonomy (404/410 or trashed ->
`external_content_missing`; 401/invalid_grant -> `connection_revoked`;
5xx/timeout/429 -> `external_source_unreachable`).

Deliverables:
- Provider implementation + registration in composition (provider registry).
- Drive HTTP gateway behind a small interface so tests inject a fake; a fake
  Drive server for integration-style tests (no network in CI).
- Passes `provider-conformance.ts`; trashed-file case covered explicitly.
- Upload path (`put_content`) used later by publish flow; verifies size and
  captures integrity (md5Checksum) into `ExternalContentRef`.

Depends on: google-drive-oauth-connection.
Next after done: external-content-delivery-fallback wires it into delivery.
