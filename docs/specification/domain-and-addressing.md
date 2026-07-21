# Domain and addressing

## DA-LOCATOR — Locator

A locator contains:

- one namespace;
- an optional page name; omission addresses the namespace's default page.

The model is independent of URL mapping. The current web adapter maps it to
`/<namespace>[/<page-name>]`, but another adapter may use a different shape
without changing publishing, ownership, search, or resolution rules.

Locator identity is case-insensitive; accepted publisher casing is preserved for
display. `site`, `api`, and `auth` are reserved namespaces. Publishing and
lookup must use the same validation boundary.

## DA-NAMESPACE — Namespace

A reserved namespace belongs to one application user. Only that user can mutate
managed pages in it. One user may reserve several namespaces.

An unreserved namespace may contain guest trial pages. A guest does not acquire
ownership, cannot write into a reserved namespace, and cannot stop another guest
or a future owner from replacing a trial locator.

## DA-PAGE — Logical page

A page is one managed and explored item with:

- an opaque stable page ID, separate from every public locator;
- one current immutable content-asset reference;
- one complete endpoint set;
- trial or managed stewardship;
- public or private access;
- zero to ten canonical tags;
- a positive revision and creation/update timestamps.

A rename or endpoint change keeps the page ID. Alternate endpoints do not gain
their own ID, revision, tags, access, management row, or exploration row.

Trial pages are public and unowned. Managed pages record their owner only in
server-controlled storage and may be public or private.

## DA-ENDPOINT — Delivery endpoint

An endpoint binds a locator to one page and one delivery profile: `inline` or
`attachment`. The content handler declares which profiles it supports.

An endpoint set has one structurally canonical binding and zero to seven
alternates. All bindings:

- use valid, case-insensitively unique locators;
- belong to the canonical locator's case-insensitive namespace;
- preserve accepted publisher spelling;
- participate in the same collision space;
- resolve to the page's one current asset.

Canonical does not imply inline. Alternate order is not semantic and storage
orders it deterministically. Replacing an endpoint set supplies all bindings at
an exact page revision and commits the page plus every old/new claim atomically.
No path suffix has delivery meaning.

## DA-ASSET — Content asset

A content asset is an immutable validated payload with intrinsic metadata:
content type, media type, size, and optional safe download filename. A page
references one current asset; all its endpoints therefore expose one coherent
payload.

Content replacement stages a fresh asset before atomically switching the page
reference. An asset has no public address without an eligible page endpoint.
Deleting or replacing a page may leave an unreferenced asset, but must never
publish incomplete data or remove data still referenced by another page.

## DA-CONTENT — Supported content

`md-page` stores Markdown source, sanitized derived HTML, and optional CSS. It
supports inline delivery.

`pdf` stores detached bytes and bounded filename/version metadata. It supports
inline and attachment delivery. Validation requires at most 16 MiB, a byte-zero
PDF 1.0–1.7 or 2.0 header, and terminal `startxref`/`%%EOF` structure pointing
to an xref table or xref-stream object. This is structural screening, not
malware detection or sanitization.

Delivery profile belongs to the endpoint, not the asset or filename.

## DA-ACCESS — Visibility

- Public managed pages can be delivered, wrapped, and explored.
- Private managed pages can be delivered only to their creator's current
  authenticated session and never appear in public queries.
- Trial pages can be delivered or wrapped by known locator but never appear in
  creator-backed exploration.

Missing, invalid, private, and unauthorized visitor lookups are non-disclosing.

## DA-TAGS — Tags

Managed pages have at most ten tags. Each tag is lowercased and trimmed, is 1–32
ASCII characters, starts and ends with an alphanumeric character, and uses only
alphanumerics, `-`, or `_`. Duplicates collapse and storage sorts the set. Trial
pages have no tags.

Tag replacement is revision-bound. Rename preserves tags; duplicate copies them.
Managed filtering and public exploration use exact canonical tag matching.

## DA-LIFECYCLE — Mutation

Managed content, access, tags, endpoints, rename, duplicate, and deletion use an
exact expected revision. A successful mutation increments once; stale intent
fails without mutation.

Create may atomically replace trials occupying its planned endpoints but never a
managed page. Endpoint movement is all-or-none. Duplicate creates a fresh page
and endpoint set from one exact source revision and may share the source's
immutable asset. Delete removes the page and every endpoint claim.

Bulk access and deletion accept 1–100 distinct page/revision selections. The
selection is validated before mutation; accepted items execute independently in
input order and return one non-disclosing outcome each.
