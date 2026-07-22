---
name: external-content-delivery-fallback
description: Step 7 of external-content-storage - delivery-time resolution of external assets with graceful missing handling and visitor placeholder content. Load when working on delivery of external content or the missing-content fallback.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, delivery, fallback]
relates: [external-content-storage, google-drive-provider, content-asset-external-source]
---

Completed external provider resolution for direct and wrapped visitor delivery.
Provider bytes are bounded and verified against authoritative local size and
SHA-256 facts before serving. Missing, revoked, integrity, unregistered, and
transient failures use one isolated platform `503` fallback; only definitive
failures persist asset-bound, revision-neutral `external_missing` health.
Verified recovery clears health, and health-write outages do not break visitor
responses.

Memory and Deno KV share repository conformance for idempotent health updates.
Google Drive preserves the safe revoked cause. Documentation and the complete
649-test suite are current.

Next: `external-missing-owner-warning` exposes this state and repair actions to
creators.
