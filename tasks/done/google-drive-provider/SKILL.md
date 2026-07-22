---
name: google-drive-provider
description: Implemented Step 6 of external-content-storage - Google Drive ExternalStorageProvider with bounded Drive v3 HTTP, token refresh, normalized failures, and production registry composition. Load when reviewing or changing the Drive provider adapter.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, google-drive]
relates:
  [
    external-content-storage,
    external-storage-provider-interface,
    google-drive-oauth-connection,
    external-content-delivery-fallback,
  ]
---

Implemented under `lib/external-storage/google-drive-{gateway,provider}.ts`.
The adapter supports read/stat/write, stores Drive `md5Checksum` as
`version_hint`, refreshes and persists tokens single-flight, revokes invalid
connections, and maps provider details onto the two provider-neutral outcomes.
Original mode registers it in application composition; local consent mode does
not expose remote content storage. `deno task verify` passes all 639 tests.
Next: `external-content-delivery-fallback` wires provider resolution into page
delivery with integrity verification and the visitor-safe placeholder.
