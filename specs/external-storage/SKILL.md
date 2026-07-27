---
name: external-storage
description: Provider-neutral external content custody - interfaces, asset sources, connections, Google Drive adapter, delivery fallback, owner repair, management surface. Load when extending providers or touching external content.
updated: 2026-07-23
sources:
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
    fix-google-drive-upload-error-mapping,
  ]
---

Creators connect their own storage (Google Drive first) and keep validated page
bytes there. The normative product contract is
`docs/specification/external-storage.md`; this is the implementation map.

## Core invariant

All metadata is local and authoritative: content type, media type, exact size,
required SHA-256, codec/schema version, optional safe filename, page state,
locators, revisions. Only payload bytes may live externally. Provider metadata
never overrides local facts — otherwise remote in-place edits would mutate a
committed asset without a page revision.

## Provider contract (`lib/external-storage/`)

- `ExternalContentRef` = provider ID (route-safe, bounded) + connection ID +
  provider-native object reference + optional version hint.
- Providers must implement bounded `read` and `stat`; `write` and `delete` are
  separately advertised optional capabilities. Read-only sources are valid;
  external publish/replace is offered only for write-capable connections and
  never silently falls back inline. Page replacement or deletion never implies
  remote deletion.
- Failure taxonomy is load-bearing and normalized to two outcomes:
  `external_content_missing` (definitive — deleted, trashed, access revoked)
  and `external_source_unreachable` (transient — outage, rate limit, unknown
  provider, unregistered provider ID). Missing drives owner warning and health;
  unreachable must never mark content missing.
- `provider-registry.ts` is an immutable validated resolver; `memory-provider.ts`
  is the reference adapter with fault injection; `provider-conformance.ts` is the
  shared suite every provider must pass. Credentials reach providers through
  their own composition, not through the interface.

## Assets

`ContentAsset` discriminates `{ kind: "inline" }` from `{ kind: "external", ref }`.
Assets stay immutable — repair creates a new asset and a new page revision.
External assets require valid bounded refs, local SHA-256, and a codec version;
mixed shapes are rejected by `content_asset_violation`. Deno KV writes no payload
object for external assets and decodes legacy source-less manifests as inline
without migration.

## Connections

`StorageConnection` = connection ID, user ID, provider ID, provider subject,
granted scopes, status (`active` | `revoked`), timestamps. One active connection
per (user_id, provider_id); same-subject reconnect reauthorizes the record.
Revoked metadata is retained so dependent assets can explain why they are
missing, while token material is destroyed.

Credentials are separate server-only records encrypted with
`AesGcmStorageCredentialCipher` (AES-256-GCM, connection ID as AAD, key from
`IAM_PAGER_STORAGE_TOKEN_KEY`, base64url). Memory and Deno KV pass one shared
conformance suite; no API, view model, URL, cookie, or log exposes tokens.

Disconnect confirms intent, attempts remote revocation, and always destroys local
credentials even when the provider is unavailable. It is allowed while assets
depend on it — dependents become `external_missing` and need repair. Blocking
disconnect and automatic retargeting are rejected.

## Google Drive

Storage OAuth is a second `@kindkitchen/gauth` composition under
`IAM_PAGER_GOOGLE_DRIVE_*`, fully separate from sign-in: own client, own exact
callback, `drive.file` scope only, offline access, forced consent. One-use state
is stored hashed and bound to user, session, PKCE context, callback, and expiry
in its own repository/prefix. Disconnect is POST-only and CSRF-protected.

`google-drive-gateway.ts` + `google-drive-provider.ts` implement read/stat/write
over Drive v3 with bounded fetches, single-flight token refresh with persistence,
and connection revocation on `invalid_grant` or still-unauthorized access.
Mapping: 404/410/trashed/definitive read-or-stat 403/version drift/size drift →
missing; 429/5xx/transport/unknown → unreachable; **upload 403 → provider error →
unreachable** (an upload creates a file, so it can never be "missing").
`md5Checksum` is stored as the version hint. Original mode registers the provider;
local consent mode is mock-only and registers no remote provider. Tests use the
in-process fake Drive and token server — no network.

Production setup requires the Google Drive API enabled in the OAuth client's
Cloud project, plus consent-screen test users.

## Delivery and fallback

Page eligibility is resolved first, so invalid, absent, private, and unauthorized
lookups keep the non-disclosing `404`. For an eligible page whose external bytes
fail, delivery returns bounded platform-owned HTML with `503`, `no-store`, safe
isolation headers, no provider detail, and a bounded retry hint when available;
the wrapped site view returns its own `503` state. `200` placeholders and `404`
for lost bytes are rejected; there is no persistent stale-byte cache in V1.

Successful fetches are bounded by the local size and verified against local size
and SHA-256 before serving with local media type, filename, endpoint profile, and
access policy.

Page aggregates carry optional `external_missing` health (safe cause +
detection time). Health updates are asset-bound, revision-neutral, and
idempotent — repeated observations do not rewrite detection time, transient and
unregistered-provider failures never write health, verified recovery clears it,
and a health-write outage never breaks the visitor response. Memory and Deno KV
share conformance for it. Public list/exploration summaries materialize external
metadata without fetching provider bytes.

## Owner warning, repair, management

Management summaries and inspection expose cause and detection time to owners
only; managed lists accept the cursor-bound `external_missing=true|false` filter;
the web shows row indicators, warning details, and repair controls.

Repair paths: replace inline (including detach — V1 has no persistent cache), or
re-link the existing owner-proven connection to a byte-identical file after stat,
bounded fetch, size, and SHA-256 verification. Every repair creates a new
immutable asset, advances the exact page revision, and clears health. Visitors
never see provider details.

Connection APIs and `/site/manage` expose only owner-safe metadata, support
connect/reconnect/disconnect, and warn that dependent assets do not block
disconnect. Active write-capable connections appear in Markdown/PDF publish and
replacement flows. External selection validates and renders canonical bytes
locally, uploads through `put_content` before the page commit, then persists a
payload-free asset. Upload failure fails the publication atomically and never
falls back inline.

## Not in V1

No background sync, no provider-side editing pipeline, no multi-account per
provider, no content migration tooling, no automatic remote deletion.
