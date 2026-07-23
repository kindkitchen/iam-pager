---
name: google-drive-preview-oauth
description: Make Google Drive mock OAuth work on allowlisted preview hosts without client credentials. Load when changing Drive OAuth configuration, request-derived callback URLs, or preview deployment settings.
created: 2026-07-23
updated: 2026-07-23
tags: [oauth, google-drive, deployment]
relates: []
---

Completed credential-free Google Drive preview OAuth hardening. Local mode plus a full-host pattern now has composition-root regression coverage, original-mode credential failures identify their mode requirement, and deployment docs show the complete profile.
Validated with `deno task verify` (667 tests) and `deno task build`.
