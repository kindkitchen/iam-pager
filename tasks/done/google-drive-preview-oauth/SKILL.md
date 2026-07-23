---
name: google-drive-preview-oauth
description: Make Google Drive mock OAuth work on allowlisted preview hosts without client credentials. Load when changing Drive OAuth configuration, request-derived callback URLs, or preview deployment settings.
created: 2026-07-23
updated: 2026-07-23
tags: [oauth, google-drive, deployment]
relates: []
---

Completed local Drive preview-host inheritance. Drive local mode uses its own pattern first, a complete static URL pair second, and otherwise inherits Google auth's validated request-host pattern; original mode remains independent.
Validated with `deno task verify` (667 tests) and `deno task build`.
