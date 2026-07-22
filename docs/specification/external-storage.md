# External content storage

This document selects the product and technical boundary for externally stored
content. The provider interface family, external asset-source persistence, and
storage-connection repository with encrypted token custody and the separate
Google Drive OAuth connect/disconnect flow are implemented, but external content
storage is not available until provider, delivery, and management work lands.

## ES-BOUNDARY — Custody and meaning

An external content source means that an immutable `ContentAsset` keeps its
identity and authoritative metadata in iam-pager while its canonical payload is
stored in a creator-connected provider. iam-pager fetches and serves that
payload; it never redirects a visitor to a provider URL.

Pages, locators, endpoint profiles, access policy, ownership, tags, page and
asset revisions, content type, media type, byte length, SHA-256 checksum, and
safe filename always remain local. Provider credentials and opaque object
references are operational data, not page content, and are never public.

An asset has exactly one source:

- `inline`: the validated canonical payload is held by the page repository;
- `external`: the asset holds a stable provider ID, creator-owned connection ID,
  opaque provider object reference, and optional provider version hint instead
  of inline payload bytes.

The source does not change page, locator, access, or delivery-profile semantics.
External storage is available only to authenticated creators; guest trial
publishing remains inline. Markdown and PDF remain the only content types.

## ES-ASSET — Validation, metadata, and immutability

Publication and replacement accept content through the existing bounded content
handlers. iam-pager validates and derives the canonical stored payload before a
provider with write capability receives it. Only after upload succeeds does the
application commit an external asset and atomically point the page at it.

The local asset record is authoritative and contains:

- content type and media type;
- exact canonical payload size;
- required SHA-256 checksum;
- optional safe download filename;
- the content codec/schema version needed to decode it;
- either inline payload data or the external source reference.

These values are committed validation facts, not a mutable cache of provider
metadata. External assets require the checksum and codec version structurally
and contain no `data` field or KV payload record. Existing source-less KV
manifests decode as inline assets without migration. A provider filename, media
type, size, or checksum cannot override local facts during delivery. Provider
account labels and connection health belong to the storage-connection model, not
the asset.

Before serving an external payload, iam-pager obtains the complete bounded
payload and verifies its size and checksum. A provider-side edit at the same
object reference therefore cannot mutate an asset silently. A version-hint
mismatch, size mismatch, checksum mismatch, deletion, or definitive permission
loss makes the source `external_missing`; altered bytes are never served. Range
and conditional delivery are applied only after the canonical payload has been
verified, preserving the existing PDF contract.

## ES-PROVIDER — Provider capability set

`ExternalStorageProvider` is an application interface selected through a
provider registry. Every registered provider has one stable non-secret ID,
normalizes provider failures into application outcomes, and declares these v1
capabilities:

- `read` is mandatory: retrieve an exact referenced object within application
  bounds and distinguish definitive missing/auth failures from retryable
  unavailability;
- `write` is optional: store an already validated canonical payload and return
  an opaque object reference plus any version hint;
- `delete` is optional: remove an explicitly selected provider object.

A provider without `read` cannot be registered. Publishing or replacing into an
external connection is offered only when its provider has `write`; there is no
silent fallback to inline storage. `delete` is never inferred from page
replacement or deletion because assets may be shared and provider data remains
creator-owned. Any later cleanup operation must prove that the asset is
unreferenced, require explicit owner intent, and report providers without delete
capability.

Provider SDKs, OAuth, HTTP, and error details stay behind the interface. Page
services and web components consume normalized capabilities and outcomes rather
than provider-specific behavior.

`lib/external-storage/` now implements this boundary: bounded opaque references,
complete bounded fetches, stat, optional put/delete operations, definitive
`external_content_missing` versus retryable `external_source_unreachable`
outcomes, an immutable-at-composition registry, and a reusable conformance
suite. The in-memory implementation is a reference adapter and test double, not
an externally durable provider.

## ES-CONNECTION — Credential custody and revocation

A storage connection belongs to one application user and one provider. V1 allows
at most one live connection per provider per user. A connection does not
establish identity, namespace authority, or page access.

Google Drive storage uses a separate OAuth registration from Google sign-in,
with separate client credentials and exact storage callback URIs. It requests
only the scopes required for files created or selected through iam-pager
(`drive.file` for v1) and requests offline access only when server-side refresh
is required. Scope expansion always requires a new explicit consent flow.

Access and refresh tokens are stored only server-side and encrypted at rest with
an authenticated encryption key held outside the connection database. They are
never returned by an API, placed in presentation models, URLs, cookies, or logs,
or shared with the sign-in strategy. Refresh and provider revocation happen
behind the provider adapter; diagnostics use bounded application error codes.

Reauthorization may restore credentials on the same connection. Explicit
disconnect requires owner confirmation, attempts provider revocation, and then
destroys local token material even when remote revocation fails. Disconnect is
not blocked by dependent assets: blocking cannot prevent provider-side
revocation and would trap the owner. Dependents retain their metadata but become
`external_missing` until each page is repaired. A later new connection does not
silently retarget old object references.

`lib/external-storage/` now defines strict owner-safe connection metadata and a
repository contract for create, lookup, owner listing, active uniqueness,
revocation, same-subject reauthorization, and provider-only credential access.
Memory and Deno KV satisfy one conformance suite. The KV implementation retains
revoked metadata, removes token material on revocation, and stores credentials
only as randomized AES-256-GCM ciphertext authenticated to the connection ID.
The 256-bit key is supplied outside KV as canonical base64url configuration
(`IAM_PAGER_STORAGE_TOKEN_KEY`); key loss is credential loss. The repository has
no management serialization path capable of carrying tokens.

Google Drive storage consent is a second explicit gauth composition under the
`IAM_PAGER_GOOGLE_DRIVE_*` namespace, never the sign-in registration. It uses
its own exact callback and local mock-consent routes, requests `drive.file` as
the only Drive permission alongside gauth's verified-account identity scopes,
and forces offline explicit consent. Raw state is never stored: its hash, PKCE
context, exact callback, session ID, user ID, and expiry use a separate
`storage-oauth-attempts/google-drive` persistence prefix and are consumed once
before exchange. Connect and callback require the same authenticated session.
Successful consent creates or same-subject reauthorizes one connection while
preserving an existing refresh token if Google omits it. CSRF-protected POST
disconnect attempts provider revocation, then revokes locally and destroys
credentials even when the remote request fails.

## ES-DELIVERY — Resolution and failure behavior

Page authority and visibility are resolved before the content source. Invalid,
absent, private, and unauthorized visitor lookups therefore keep the existing
non-disclosing `404`; no provider call may reveal such a page.

For an otherwise eligible page:

- verified external bytes use the existing successful direct and wrapped
  delivery behavior, headers, validators, disposition, and access policy;
- a definitive missing object, credential revocation, permission loss, or
  integrity mismatch returns a platform-owned `503` placeholder saying only that
  the content is temporarily unavailable;
- a timeout, provider outage, or rate limit may receive a bounded in-request
  retry, then returns the same non-disclosing `503` placeholder and a safe retry
  hint.

The placeholder is bounded HTML, uses `no-store`, never includes provider,
account, object, token, or failure details, and is not emitted as the asset's
media type. This does not weaken the `404` invariant: the page has already been
shown to be eligible and only its payload is unavailable. Missing and transient
failures intentionally look the same to visitors.

Definitive failures record or refresh `external_missing` health for owner
management. Retryable failures never mark an asset missing. V1 has no persistent
payload cache, so stale bytes are not served during an outage. Success clears a
previous observational warning only after full integrity verification.

Owners see a bounded warning and safe cause category for affected pages. Repair
creates or selects a valid replacement asset at an exact page revision by:

- reauthorizing the existing connection when the provider object still matches;
- uploading the validated content again, externally or inline; or
- replacing the page's asset reference with another validated source.

Repair never mutates an immutable asset or silently changes every page that may
share it.

## ES-LIFECYCLE — Operations

1. The creator connects a provider account through the storage consent flow.
2. Publish or replace validates content locally and, when external storage is
   selected, uploads before committing the asset and page reference.
3. Delivery resolves page access, fetches through the owning connection,
   verifies the local integrity facts, and serves through iam-pager.
4. Page replacement or deletion leaves provider objects intact by default.
5. Provider deletion, access loss, disconnect, or integrity drift produces the
   failure and repair behavior above.

Metadata and content never become visible in a half-committed state. Failed
upload cannot create an asset or change a page; failed page commit may leave an
unreferenced provider object for explicit later cleanup.

## ES-NONGOALS — V1 exclusions

V1 does not provide background synchronization, provider-side editing,
persistent or stale payload caching, provider redirects, arbitrary existing-file
publication that bypasses content validation, multiple accounts for one provider
per user, automatic migration between inline and external storage, automatic
remote deletion, generic binary content, or a provider-agnostic file browser.
