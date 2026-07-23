---
name: external-missing-owner-warning
description: Completed step 8 of external-content-storage - owner-facing external health, filtering, warnings, and revision-bound repair. Load when reviewing missing-content management or repair behavior.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, management, fallback]
relates: [external-content-storage, external-content-delivery-fallback]
---

Completed owner warning and repair management for `external_missing`.

Management summaries and inspection expose the safe cause and detection time;
managed lists accept the cursor-bound `external_missing=true|false` filter. The
web shows affected-row indicators, warning details, and repair controls.

Repair either replaces content inline (including detach, because V1 has no
persistent cache) or re-links the existing owner-proven provider connection to
a byte-identical file after stat, bounded fetch, size, and SHA-256 verification.
Every repair creates a new immutable asset, advances the exact page revision,
and clears health without exposing provider details to visitors.

Next: `external-storage-management-surface` completes external publishing and
connection settings UX.
