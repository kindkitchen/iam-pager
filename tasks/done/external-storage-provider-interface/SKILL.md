---
name: external-storage-provider-interface
description: Implemented Step 2 of external-content-storage - provider interfaces, registry, conformance suite, and memory reference adapter. Load when changing the storage-provider contract.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, interfaces]
relates: [external-content-storage, external-storage-spec]
---

Implemented `lib/external-storage/` with bounded provider models and fetches,
mandatory read/stat plus optional write/delete operations, normalized
missing/unreachable failures, a validated resolver registry, reusable provider
conformance tests, and an isolated in-memory reference adapter with fault
injection.

README, changelog, and specifications describe the implemented boundary while
keeping external storage unavailable. `deno task verify` passes with 568 tests
(13 steps).

Next: `content-asset-external-source` consumes `ExternalContentRef` while local
asset metadata remains authoritative.
