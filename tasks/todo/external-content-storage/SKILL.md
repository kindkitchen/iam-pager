---
name: external-content-storage
description: Epic - let creators connect their own storages (Google Drive first) so page content bytes live externally while all metadata stays local. Load when planning or sequencing any external-storage work.
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

Umbrella for the external-storage integration feature. Content bytes may live
in a creator-connected storage (Google Drive first, GitHub etc. later); all
metadata (assets, pages, locators, policies) stays local. Provider work is
interface-first so new providers are additive.

Execution chain (one by one, each task unblocks the next):

1. `external-storage-spec` - product + technical specification, docs.
2. `external-storage-provider-interface` - provider interface family, registry,
   conformance suite. No provider yet.
3. `content-asset-external-source` - extend `ContentAsset`/storage so an asset
   can declare an external source instead of inline data.
4. `storage-connection-model` - per-user storage-connection model, token
   custody, KV repository.
5. `google-drive-oauth-connection` - separate gauth registration (own client,
   own redirect URIs, Drive scopes), connect/disconnect flow, local mock mode.
6. `google-drive-provider` - Drive implementation of the provider interface,
   passing the conformance suite.
7. `external-content-delivery-fallback` - delivery-time resolution, graceful
   missing handling, visitor-facing placeholder content.
8. `external-missing-owner-warning` - owner warning surface + repair flow
   (re-link / re-upload / detach).
9. `external-storage-management-surface` - API + web UI for connections and
   choosing storage at publish/replace time.

Status: chain drafted, no task started. Next: activate `external-storage-spec`.
