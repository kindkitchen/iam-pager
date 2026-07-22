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

A page is one managed and explored content item with:

- an opaque stable page ID, separate from every public locator;
- one current immutable content-asset reference;
- one non-empty set of locator references;
- trial or managed stewardship;
- public or private access;
- zero to ten canonical tags;
- a positive revision and creation/update timestamps.

Content identity and bytes do not depend on a locator. A locator change keeps
the page ID, and replacing content keeps every locator unless replacement also
supplies a new complete set. Additional references do not gain their own ID,
revision, tags, access, management row, or exploration row.

Trial pages are public and unowned. Managed pages record their owner only in
server-controlled storage and may be public or private.

## DA-ENDPOINT — Delivery endpoint

An endpoint is a reference that binds one locator to one logical page and one
explicit delivery profile. `inline` and `attachment` are the current profiles;
profiles are bounded lowercase identifiers so later delivery capabilities do not
change content or locator identity. Each content handler declares the subset it
supports.

An endpoint set is non-empty. One binding is structurally canonical only to give
management, exploration, sorting, and generated links a stable preferred
locator; canonical is not content identity and does not imply a delivery
profile. Zero or more alternate bindings may point to the same content. All
bindings:

- use valid, case-insensitively unique locators;
- preserve accepted publisher spelling;
- participate in the global locator collision space;
- resolve to the page's one current asset;
- pass namespace authority independently.

A managed actor must own every referenced namespace; every trial namespace must
be unreserved. Alternate order is not semantic and storage orders it
deterministically. Replacing an endpoint set supplies all bindings at an exact
page revision and commits the page plus every old/new claim atomically. No path
suffix has delivery meaning. A storage adapter may report a capacity failure for
a set it cannot commit atomically; that is not a content-format rule.

## DA-ASSET — Content asset

A content asset is an immutable validated payload with authoritative local
metadata: content type, media type, exact size, required SHA-256 checksum,
content codec version, and optional safe download filename. A page references
one current asset; all its endpoints therefore expose one coherent payload.

An asset has exactly one source. An inline source contains the canonical
payload; an external source contains a stable provider ID, creator-owned
connection ID, opaque provider object reference, and optional version hint.
External source selection changes payload custody only: page, locator, endpoint,
access, and metadata semantics remain local. Provider metadata cannot override
the committed asset facts, and fetched bytes must match size and checksum before
delivery.

Content replacement stages a fresh asset before atomically switching the page
reference. External publication additionally uploads validated content before
the asset can be committed. Replacement does not require locator resubmission.
If the content type changes, every retained endpoint profile must be supported
by the new handler. An asset has no public address without an eligible page
endpoint. Deleting or replacing a page may leave an unreferenced inline or
provider payload, but must never publish incomplete data or remove data still
referenced by another page. The complete external-source contract is in
[external-storage.md](external-storage.md).

## DA-CONTENT — Supported content

`md-page` stores Markdown source, sanitized derived HTML, and optional CSS. It
supports inline delivery.

`pdf` stores detached bytes and bounded filename/version metadata. It supports
inline and attachment delivery. Validation requires at most 16 MiB, a byte-zero
PDF 1.0–1.7 or 2.0 header, and terminal `startxref`/`%%EOF` structure pointing
to an xref table or xref-stream object. This is structural screening, not
malware detection or sanitization.

Delivery profile belongs to each locator reference, not the asset, preferred
locator designation, filename, or content type. A profile may be used only when
the selected content handler supports it.

## DA-ACCESS — Visibility

- Public managed pages can be delivered, wrapped, and explored.
- Private managed pages can be delivered only to their creator's current
  authenticated session and never appear in public queries.
- Trial pages can be delivered or wrapped by known locator but never appear in
  creator-backed exploration.

Missing, invalid, private, and unauthorized visitor lookups are non-disclosing.
After a page is established as eligible, unavailable external bytes return the
bounded platform placeholder defined by `ES-DELIVERY`; this discloses no page
that would otherwise be hidden.

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
