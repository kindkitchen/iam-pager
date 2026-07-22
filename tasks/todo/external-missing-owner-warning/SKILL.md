---
name: external-missing-owner-warning
description: Step 8 of external-content-storage - surface external-missing state to owners (management API + UI warning) and provide the repair flow (re-link, re-upload, detach). Load when working on owner warnings or missing-content repair.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, management, fallback]
relates: [external-content-storage, external-content-delivery-fallback]
---

Make the owner aware and able to fix. Consumes the `external_missing` state
recorded by step 7.

Deliverables:
- Management API: page management payload includes
  `external_missing: { cause, detected_at }`; management list supports
  filtering pages with missing external content.
- Web management UI: warning banner on affected pages + indicator in the
  creator page list (islands/components per project CamelCase convention).
- Repair actions (each creates a NEW asset or reference, assets stay
  immutable): re-link to another external file; re-upload content inline;
  detach = replace with inline copy if bytes still cached/available, else
  plain replace flow.
- Repair clears `external_missing`; covered by API + UI tests.

Depends on: external-content-delivery-fallback.
Next after done: external-storage-management-surface completes the UX.
