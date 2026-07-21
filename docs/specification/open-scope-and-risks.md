# Open scope and active risks

This file contains only unresolved product work and risks that constrain current
behavior.

## OS-LIMITS — Capacity and retention

Total stored size, page count, publishing frequency, and guest expiry are not
implemented. The service must choose and explain whether a reached limit rejects
a new publication or removes existing content. Authenticated content must not be
described as permanently durable without an explicit backup and retention
policy.

Deno KV records remain until application deletion, session expiry, or operator
action. Failed content staging can leave unreachable payloads; no sweeper
exists. Changing storage backend or path does not copy data.

## OS-CONTENT — Additional content

Active HTML, SVG, generic binary files, broader media inference, thumbnails,
PDF.js, PDF text extraction, and external storage are unselected. Each new type
requires an explicit size band, validation, delivery profiles, management model,
and safe wrapped-view policy. PDF's current structure screen is not malware
certification.

## OS-SEARCH — Search depth

Exploration currently scans current public page metadata for namespace/page-name
substrings and exact tags. Text extraction, indexing, relevance, and view-count
sorting remain later capabilities. Any index must preserve immediate privacy
when access becomes private.

## OS-EXTERNAL — External storage

A future provider such as GitHub or Google Drive must preserve page, locator,
endpoint, authority, and privacy semantics. The product must state whether it
copies, synchronizes, redirects, or serves provider content and must fail closed
when credentials or remote items disappear.

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

Storage records fail closed on unknown or corrupt shapes. Storage has one
current format and no migration or rollback machinery; changing that format
requires an explicit deployment decision once retained data matters.
