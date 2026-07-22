---
name: external-storage-management-surface
description: Step 9 of external-content-storage - API and web UI for managing storage connections and choosing external storage at publish/replace time. Load when working on the storage-connections settings UI or publish-to-Drive UX.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, ui, api]
relates: [external-content-storage, external-missing-owner-warning, google-drive-oauth-connection]
---

Final composition step: creator-facing surfaces over finished capabilities.

Deliverables:
- Connections API: list own connections (provider, subject, scopes, status -
  never tokens), initiate connect (redirect to step-5 flow), disconnect.
- Settings UI: "Connected storages" section - connect Google Drive, show
  status, disconnect with dependent-assets warning (spec decision from
  step 1 applies).
- Publish/replace flow: when an active connection with `write` capability
  exists, offer "store content in <provider>"; upload via provider
  `put_content`, create external asset; without connection the option is
  absent and current flow unchanged.
- API contract matrix + docs (`docs/api`, specification) + CHANGELOG.

Depends on: all previous chain steps.
Closes the epic when done: refresh `external-content-storage` and move the
chain tasks to done.
