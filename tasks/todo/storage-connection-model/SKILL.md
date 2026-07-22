---
name: storage-connection-model
description: Step 4 of external-content-storage - per-user storage-connection model, token custody, and KV repository with conformance suite. Load when working on storage connections or provider token persistence.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, storage]
relates: [external-content-storage, external-storage-provider-interface]
---

Model the creator's link to one provider account: identity, granted scopes,
token custody, status (`active` | `revoked`). Pattern-copy of the identity
repository (interface + conformance + memory + KV implementations).

Deliverables:
- `lib/external-storage/connection-model.ts`: `StorageConnection`
  (connection_id, user_id, provider_id, provider_subject, scopes, status,
  timestamps) + validators; token material referenced, never serialized into
  management/API payloads.
- `connection-repository` interface + `connection-repository-conformance.ts`
  + memory + `lib/storage/kv-storage-connection-repository.ts`.
- Token custody helper: encrypted-at-rest storage for refresh/access tokens.
- Uniqueness: one active connection per (user_id, provider_id) in v1.

Depends on: external-storage-spec (custody decisions), provider-interface.
Next after done: google-drive-oauth-connection populates this model.
