---
name: external-content-delivery-fallback
description: Step 7 of external-content-storage - delivery-time resolution of external assets with graceful missing handling and visitor placeholder content. Load when working on delivery of external content or the missing-content fallback.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, delivery, fallback]
relates: [external-content-storage, google-drive-provider, content-asset-external-source]
---

Wire external assets into the visitor delivery path (`lib/page/service.ts`,
`delivery-http.ts`): resolve provider via registry, fetch bytes, deliver with
locally cached meta. Handle loss gracefully.

Deliverables:
- Delivery resolution for `source.kind === "external"`; inline path
  byte-identical to today.
- `external_content_missing` -> record missing state on the page aggregate
  (cause + detected_at), serve mock placeholder content (bounded, cacheable
  no-store) instead of raw 404; `connection_revoked` treated as missing with
  its own cause.
- `external_source_unreachable` -> 503-style retryable response, NOT marked
  missing; no state change.
- Placeholder produced by a dedicated fallback content handler so it flows
  through the normal `ContentTypeHandler` render path.
- Recovery: successful fetch after missing clears the missing state.

Depends on: google-drive-provider (or memory provider for tests).
Next after done: external-missing-owner-warning exposes the state to owners.
