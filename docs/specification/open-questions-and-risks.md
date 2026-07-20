# Open questions and nearby risks

## OQ-SETTLED — Settled directions

### OQ-LOCATOR — Locator abstraction

The functional locator is a namespace plus an optional page name, as defined by
`DA-LOCATOR`. The specification does not choose between a path, subdomain, or
another public URL mapping. A deployment must select and validate a concrete
mapping, but that choice is not an open product question and must not change
publishing, search, ownership, or page resolution behavior.

### OQ-GUEST — Guest publishing

Guest publishing is a limited form of normal publishing, not a separate product
direction. A guest has stricter limits and does not reserve the namespace;
overwrite behavior is accepted as described by `DA-NAMESPACE`.

### OQ-AUTH — Account entry and recovery

The first account-entry flow is Google-first sign-in: a verified Google subject
atomically finds or creates one application user and external identity, so there
is no separate registration form or application password. The guest logical
session is upgraded in place to preserve attributable guest activity while its
bearer rotates; matching email never links another provider identity.

Account recovery for this flow belongs to Google. The application provides no
password reset or provider-account recovery. Identity storage is process-local
by default; optional Deno KV persists users and provider identities together
with namespace claims, but still provides no account deletion or
application-managed recovery. Logout revokes the currently authenticated session
and establishes an unrelated fresh guest; it does not delete the application
user, provider identity, or namespace reservation. Reservation and concurrent
uniqueness remain an explicit authorization capability, not an effect of
authentication itself.

### OQ-ACCESS — Public and private behavior

Trial pages are always public. A managed page may be public or private, and its
creator changes access through the same atomic revision-bound PATCH used for
content updates. Direct delivery observes the committed representation
immediately. A private page is available only to its stored creator's current
session and is ordinary missing to guests, logged-out creators, and other users.
The site-mediated view applies the same non-disclosure: private pages are
ordinary missing. Namespace public listings and cross-namespace exploration are
cursor-bounded and exclude both private and trial pages from current storage
state; trial pages remain reachable only by a known direct or site-view locator.

### OQ-EXPLORE — Public exploration

The first exploration version is settled as deterministic browse plus
case-insensitive substring search over author namespaces and page names and one
optional exact canonical tag. Supplied fields use AND semantics. Default pages
have no page-name value and therefore match only when that query is absent.
Private and guest pages are excluded from current storage state before results
cross the public contract.

Tag filtering is implemented in the HTTP-independent explorer, bound into its
cursor scope, and exposed by the site GET form. Text-content extraction and
indexing, relevance ranking, and view-count sorting are not part of this MVP
slice. The `PublicPageExplorer` boundary permits a later index without changing
locators, site-view links, or visitor-safe result summaries.

### OQ-PDF-DIRECTION — PDF content and alternate delivery endpoints

PDF is the next selected content expansion; generic raw-binary publication is
not. One immutable PDF content asset backs one logical page. Publishers may bind
that asset to multiple ordinary locators and configure each endpoint's delivery
profile independently, including inline `application/pdf` browser viewing and
attachment delivery with a safe filename over the same exact bytes.

A page, its content asset, and its endpoint bindings are separate concepts.
Alternate endpoints are not separate managed or explored pages. Delivery mode is
stored with the endpoint binding and mapped by the delivery boundary. Neither
the page service nor HTTP generates a locator, interprets `.pdf`, or infers
behavior from any path shape. PDF.js, generated preview images, and text
extraction are later adapters or capabilities.

### OQ-ENDPOINT-CONFIG — Bounded user-configured endpoint set

A page has one explicitly designated canonical endpoint and zero to seven
alternates, for a maximum of eight endpoint bindings. Canonical designation is
structural rather than a flag repeated on every binding. Canonical status does
not imply `inline`: any profile supported by the content type may be canonical.
Alternates are normalized to case-insensitive locator order for stable storage
and output; their submitted order has no meaning.

Every endpoint uses an ordinary valid locator in the canonical endpoint's same
case-insensitive namespace. Each supplied spelling is preserved for display, but
all endpoint locators share the existing case-insensitive collision space and
must also be unique within the submitted set. A default locator is allowed in
either canonical or alternate position. Reserved namespaces and invalid locators
fail the complete plan. Because all endpoints share one namespace, the page's
existing namespace authority applies to every binding.

The initial delivery-profile vocabulary is `inline` and `attachment`. Every
content type declares a non-empty supported subset: `md-page` supports only
`inline`; PDF will support both. Multiple endpoints may use the same profile,
and neither profile implies a suffix or other path shape.

Endpoint add, change, remove, canonical change, and casing-only display change
replace the complete endpoint set under the page's exact revision. Reordering
otherwise identical alternates is unchanged and does not increment revision.
Repository mutation checks every old and new claim and commits the page,
revision, and endpoint indexes all-or-none. A claim held by another managed page
fails the whole operation. Managed creation may retire trials occupying any of
its planned locators only when every claim can be committed together. Concurrent
claims have one complete winner and no partial endpoint visibility.

Duplication references the same immutable asset from a fresh page and requires a
fresh complete destination endpoint set; replacing one page's content later does
not change the other page. The current `md-page` compatibility operation remains
a one-inline-endpoint special case with its bounded server-generated canonical
name. Deletion removes every endpoint binding atomically; unreferenced asset
cleanup is separate and must not delete an asset still used by another page.

### OQ-SCHEMA-UPGRADES — Explicit manual forward evolution

Deployment and runtime neither inspect nor mutate the release manifest.
`pre-deploy` is a successful informational no-op. Database safety is an explicit
developer workflow: select one exact local path or remote connector URL, run
`db:check`, and use its diagnostics before deciding whether to run the
separately confirmed `db:update`. This simplicity means a forgotten manual check
cannot block release; release discipline and record-level runtime decoding are
the remaining controls.

Manifest absence remains unversioned, not a wildcard. Since an unversioned
database cannot prove identity, initialization requires `--confirm=iam-pager`.
After initialization, wrong-project metadata cannot be updated. The command
derives current targets from code rather than accepting operator-authored
`from`/`to` vectors.

There is no inferred schema diff, rollback framework, deploy mutation,
per-schema pending state, migration lease, or contention loop. Every future
transformation is an adjacent retained migration, explicitly authored and safe
to repeat. Migrations run before one conditional publication of the complete
manifest. Failure leaves the old manifest and may leave partial repeat-safe data
work; concurrency can duplicate migration execution, while one compare-and-set
wins publication. Operators rerun `db:check` after either outcome. A migration
may be removed only after every supported database is beyond its source version.

The Deno KV adapter preserves the existing manifest key/format. Current
`ownership`, `sessions`, and `pages` targets are version 1; confirmed legacy
initialization writes metadata without rewriting already-version-1 application
records.

Runtime storage now follows environment selectors without a Deno Deploy timeline
override. Shared revision-preview databases therefore remain an operator risk:
configure those contexts as memory or preserve compatibility across every live
revision. Isolated Git branch databases remain the safer durable acceptance
target.

### OQ-API — API surface

The concrete page API includes `POST`/`GET /api/pages`,
`GET`/`PATCH`/`DELETE /api/pages/:page_id`, revision-bound rename/duplicate
actions, and bounded bulk access/delete commands, with strict nested JSON,
browser session authentication, synchronizer-token CSRF for authenticated
mutations, opaque pagination, and exact source revisions. Direct retrieval
remains the locator URL. External bearer credentials are later; see
[`docs/api/pages.md`](../api/pages.md).

## OQ-OPEN — MVP decisions still needed

### OQ-CONTENT — Supported content

`md-page` remains the implemented textual type and PDF is the first selected
binary type. Its transport-independent handler now accepts at most 16 MiB,
requires a byte-zero PDF 1.0–1.7 or 2.0 header plus terminal `startxref`/`%%EOF`
structure pointing to an xref table or xref-stream object, and detaches accepted
bytes. This is lightweight structural screening, not PDF sanitization, exploit
detection, or malware certification. Media type is fixed to `application/pdf`;
filename extension is not trusted as validation. A portable suggested filename
is required and bounded to 255 UTF-8 bytes. Inline and attachment behavior are
both declared and remain endpoint properties over one asset.

Active HTML, SVG, scripts, generic raw binary, and broader media-type inference
remain unselected. Each later type still needs an explicit size band and
display, download, or isolation policy.

### OQ-PDF-TRANSPORT — PDF upload and range delivery

The current JSON API is not an appropriate binary transport. The PDF HTTP task
must settle a strict bounded multipart or dedicated upload contract without
leaking base64 into the content/application interfaces. The core's 16 MiB limit
makes bounded full `200` delivery possible, but does not itself decide HTTP
buffering. Byte-range support is explicitly deferred to that HTTP task, where it
must be implemented and tested or rejected as unnecessary for the first
transport.

### OQ-LIMITS — Publishing limits

Choose initial limits for content size, total stored size, page count, and
frequency. Guest publishing uses stricter limits and no namespace guarantee. The
original guest-capacity phrase "removes the latest" still needs one concrete
meaning: remove an existing item, expire items, or reject the new item.

### OQ-RETENTION — Retention

State practical cleanup, deletion, and backup behavior. Avoid an absolute
promise that authenticated content can never disappear; the first version only
needs understandable normal-operation behavior.

Deno KV ownership records have the first non-expiring policy: application users,
external identities, and namespace reservations have no application deletion
workflow and remain until the selected database is manually removed. Optional
Deno KV sessions instead follow the bounded session lifecycle. Their record and
credential-index TTL is the absolute expiry; idle and absolute checks remain
service-enforced because KV cleanup is lazy, and revocation removes bearer
lookup immediately. Backup and recovery follow the KV provider or deployment
operator. Switching the backend or path does not migrate records. Opted-in Deno
KV pages remain until replaced or revision-bound deletion; a crash before a
visibility commit may leave unreachable chunks, and no sweeper exists yet. Guest
expiry, account deletion, migration, and broader backup policy remain open.

## OQ-RISKS — Nearby risks

### OQ-ISOLATION — Direct-content isolation

Raw HTML or another active format can conflict with authenticated site sessions
if it shares the same browser trust boundary. Direct HTML responses use active-
content isolation headers. The site-mediated view places supported creator HTML
in a sandboxed iframe without same-origin, script, or referrer permissions;
creator markup never enters the platform DOM. Future active formats must satisfy
those same boundaries before gaining an inline preview.

### OQ-ROUTES — Route collisions

A concrete public URL mapping can collide with application and API routes. Its
routing adapter must reserve or separate those routes before URLs are presented
as stable.

### OQ-MISSING — Missing-page fallback

Silently returning the home page for a missing URL makes clients believe the
content request succeeded. Direct and site-mediated locator routes now return
real missing responses; the wrapper deliberately uses the same 404 for missing,
private, forbidden, and malformed visitor lookups.

### OQ-FORMATS — Broad content support

Different formats and large files are part of the product direction, but trying
to support everything immediately would obscure the core publishing and direct-
delivery flow. Start with an explicit subset and keep external storage for
later. PDF is intentionally a specific first binary type; it must not create an
accidental generic-file contract.

### OQ-KV-TOOLBOX — kv-toolbox atomicity and migration

`@kitsonk/kv-toolbox` 0.31.0 is the required utility for the Deno KV
page/content adapter. Its named blob API accepts a caller-owned `Deno.Kv` and
provides segmented binary set/get/remove operations. Package types and physical
blob suffixes remain inside storage implementation files; domain, application,
HTTP, and site contracts do not depend on them. The earlier unselected Kvdex
prototype is rejected and will be removed after behavioral parity.

Blob segmentation does not itself provide application visibility. Each encoded
immutable payload is staged under a random identity, reconstructed and checked
for expected length, SHA-256, and decoding, and only then exposed by a separate
manifest published with native Deno KV compare-and-set. Known failed staging
receives best-effort cleanup; an ambiguous manifest exception retains the
payload rather than risk deleting data referenced by a commit that succeeded.
Every read repeats integrity checks.

`KvToolbox.atomic()` may split work across commits and returns multiple commit
results, so it cannot replace native `Deno.Kv.atomic()` for all-or-none page,
endpoint, owner, revision, index, or manifest visibility. The aggregate adapter
must use explicit adapter-owned records and native commits, while only payload
bytes use toolbox blob operations. Deployment continues to select the legacy raw
Deno KV page repository until unchanged aggregate conformance passes and a
manual, repeat-safe, source-preserving schema-v1 migration prevents an existing
database from being presented as empty.
