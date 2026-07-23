---
name: external-content-storage
description: Completed epic - creators can connect Google Drive and keep validated page bytes externally while iam-pager retains authoritative metadata. Load when maintaining or extending external-storage providers, custody, delivery, or management.
created: 2026-07-22
updated: 2026-07-22
tags: [epic, external-storage]
relates:
  [
    external-storage-spec,
    external-storage-provider-interface,
    content-asset-external-source,
    storage-connection-model,
    google-drive-oauth-connection,
    google-drive-provider,
    external-content-delivery-fallback,
    external-missing-owner-warning,
    external-storage-management-surface,
  ]
---

The nine-step external-storage chain is complete.

Provider-neutral custody, payload-free immutable assets, encrypted creator
connections, separate Google Drive consent, the production Drive adapter,
verified delivery/fallback, owner health/repair, connection settings, and
external publish/replace are implemented. Metadata remains authoritative and
local; requested external writes never silently fall back inline.

Future providers should satisfy the existing provider interface and conformance
suite, then be exposed through the management descriptor/presenter boundary.
