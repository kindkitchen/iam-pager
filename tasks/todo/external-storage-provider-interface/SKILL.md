---
name: external-storage-provider-interface
description: Step 2 of external-content-storage - define the provider interface family, registry, and conformance suite in lib/external-storage. Load when designing or changing the storage-provider contract.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, interfaces]
relates: [external-content-storage, external-storage-spec]
---

Create `lib/external-storage/` with the provider contract only - no concrete
provider. Mirror the auth strategy pattern: interface + resolver/registry +
conformance suite + in-memory reference implementation.

Deliverables:
- `interfaces.ts`: `ExternalStorageProvider` (id, capabilities, fetch/stat,
  optional put/delete), typed results incl. `external_content_missing` and
  `external_source_unreachable`, `ExternalStorageProviderResolver`.
- `model.ts`: `ExternalContentRef`, capability and error models, validators.
- `provider-registry.ts` (mirrors `lib/auth/strategy-registry.ts`).
- `provider-conformance.ts` + `memory-provider.ts` passing it.
- `mod.ts` barrel; tests beside each file.

Depends on: external-storage-spec (error taxonomy, capability set).
Next after done: content-asset-external-source consumes `ExternalContentRef`.
