---
name: content-asset-external-source
description: Step 3 of external-content-storage - extend ContentAsset and KV storage so an asset can declare an external content source instead of inline data. Load when touching asset source shape, codecs, or asset repositories.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, content-model]
relates: [external-content-storage, external-storage-provider-interface]
---

Domain change, provider-agnostic: an asset either materializes data inline
(today's shape, unchanged default) or carries an `ExternalContentRef` plus
locally cached `ContentMeta`. Metadata always stays local.

Deliverables:
- `lib/content/asset.ts`: discriminated `source` (`inline` | `external`),
  updated `content_asset_violation`; existing stored assets without `source`
  read as `inline` (back-compat, no migration).
- `lib/content/model.ts`: meta additions if the spec requires (integrity).
- `lib/storage/content-data-codec.ts` + `kv-content-asset-repository.ts`:
  encode/decode both shapes; external assets never store payload bytes.
- Repository conformance + tests updated for both shapes.

Depends on: external-storage-provider-interface (`ExternalContentRef`).
Next after done: storage-connection-model.
