# Open scope and active risks

This file contains only unresolved product work and risks that constrain current
behavior.

## OS-LIMITS — Capacity and retention

Total stored size, page count, publishing frequency, API-key request rate
limits, and guest expiry are not implemented. The service must choose and
explain whether a reached limit rejects a new publication or removes existing
content. Authenticated content must not be described as permanently durable
without an explicit backup and retention policy.

Deno KV records remain until application deletion, session expiry, or operator
action. Failed content staging can leave unreachable payloads; no sweeper
exists.

## OS-CONTENT — Additional content

Active HTML, SVG, generic binary files, broader media inference, thumbnails,
PDF.js, and PDF text extraction are unselected. Each new type requires an
explicit size band, validation, delivery profiles, management model, and safe
wrapped-view policy. External storage does not add a content type and cannot be
used to bypass current Markdown/PDF validation. PDF's current structure screen
is not malware certification.

## OS-SEARCH — Search depth

Exploration currently scans current public page metadata for namespace/page-name
substrings and exact tags. Text extraction, indexing, relevance, and view-count
sorting remain later capabilities. Any index must preserve immediate privacy
when access becomes private.

## OS-EXTERNAL — External storage implementation risk

The product boundary is selected in [external-storage.md](external-storage.md):
iam-pager keeps authoritative metadata locally, fetches and verifies provider
bytes, never redirects visitors, and uses a non-disclosing `503` placeholder
after an eligible page loses content. The provider interface family, registry,
conformance suite, and memory reference adapter now exist; connection,
asset-source, delivery, warning/repair, and management remain open work.

Until that chain lands, external storage must not be presented as available.
Implementation must preserve local page/locator/authority/privacy semantics,
prevent provider-side edits from mutating immutable assets, keep tokens
encrypted and server-only, distinguish definitive missing state from retryable
outages, and avoid automatic remote deletion or stale-byte delivery.

## OS-ISOLATION — Active content

Direct creator content shares a site origin and can threaten authenticated
state. Current active Markdown output uses isolation headers, and wrapped HTML
uses a sandboxed no-referrer frame. No active content type may be added without
an equivalent boundary.

## OS-OPERATIONS — Deployment

Memory repositories are unreliable across restarts or multiple instances. Deno
KV must be selected explicitly where continuity matters. Local Google mode
grants fake authentication and is safe only on loopback or narrowly designated
preview hosts.

Storage records fail closed on unknown or corrupt shapes.
