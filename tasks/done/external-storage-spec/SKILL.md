---
name: external-storage-spec
description: Completed step 1 of external-content-storage - product and technical contract for local metadata, external payload custody, provider capabilities, credentials, and failure behavior. Load when implementing or revisiting external-storage scope and invariants.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, docs]
relates: [external-content-storage, external-storage-provider-interface]
---

The normative contract is `docs/specification/external-storage.md`, linked and
reconciled across the product, domain, experience, capability, quality, risk,
README, and changelog sources. The obsolete planned `pages.md` update was
applied to `domain-and-addressing.md` and `experiences-and-scope.md` instead.

Settled: eligible pages with unavailable external bytes use a no-store `503`
placeholder while hidden pages retain `404`; authoritative metadata and SHA-256
stay local; provider read is mandatory while write/delete are optional; storage
OAuth is separate, encrypted, minimally scoped, and revocable without blocking
on dependent assets. V1 has no stale-byte cache or automatic remote deletion.

Verification: `deno task check` passes. Next: implement
`external-storage-provider-interface`.
