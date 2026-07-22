---
name: content-asset-external-source
description: Step 3 of external-content-storage - completed provider-neutral inline/external ContentAsset sources and payload-free KV persistence. Load when changing asset source shape, integrity facts, codecs, or asset repositories.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, content-model]
relates: [external-content-storage, external-storage-provider-interface]
---

Completed. `ContentAsset` discriminates explicit inline data from external
`ExternalContentRef` custody with required local SHA-256 and codec version.
Memory and KV repositories round-trip both shapes; KV writes no payload object
for external assets and decodes legacy source-less manifests as inline.
Page publication remains inline, and external materialization fails closed until
the delivery resolver lands. Verification passed all 575 tests and 13 steps.
Next: `storage-connection-model`.
