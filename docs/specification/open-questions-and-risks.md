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

### OQ-SCHEMA-UPGRADES — Explicit forward-only database evolution

Database schema evolution runs only through the explicit pre-deploy command; the
application does not mutate schema during startup or a normal request. Code
declares a target version and adjacent forward steps for each stable schema ID.
The runner preflights every plan and durable state, applies only missing steps,
and returns a no-change success after the target is reached.

There is no automatic schema-diff inference, rollback framework, or migration
mutex with a stale-lock timeout. Every transformation is explicitly authored,
repeat-idempotent, and safe under concurrent invocation: a second process can
observe and resume the same atomic pending claim before the first process has
exited. Conditional data writes make that overlap safe, while exact claim
completion lets only one process advance the durable version. A one-way helper
may be removed only after every supported environment can no longer start below
its source version.

The first state/coordination adapter is Deno KV behind agnostic interfaces. Its
initial `ownership`, `sessions`, and `pages` plans define missing framework
metadata as baseline version 1 for both fresh and existing raw-KV databases. All
current targets are version 1, so installing the framework does not inspect or
rewrite application records.

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

`md-page` remains the implemented textual type and PDF is selected as the first
binary type. The PDF slice must settle its exact byte limit and minimum
structural validation before code accepts files. Its media type is fixed to
`application/pdf`; filename extension is not trusted as validation. Inline and
attachment behavior are both required and are endpoint properties over one
asset.

Active HTML, SVG, scripts, generic raw binary, and broader media-type inference
remain unselected. Each later type still needs an explicit size band and
display, download, or isolation policy.

### OQ-ENDPOINT-CONFIG — User-configured endpoint set

`example` and `example.pdf` are only illustrations of two ordinary locators a
publisher might choose. No suffix is reserved, generated, or interpreted. Before
endpoint contracts are frozen, decide and specify the maximum endpoint count,
canonical endpoint designation, allowed delivery profiles per content type,
revision-bound add/change/remove semantics, namespace authority for every
locator, and whole-set collision behavior. An invalid or conflicting endpoint
set must fail atomically rather than partially publishing locators.

### OQ-PDF-TRANSPORT — PDF upload and range delivery

The current JSON API is not an appropriate binary transport. The PDF HTTP task
must settle a strict bounded multipart or dedicated upload contract without
leaking base64 into the content/application interfaces. Browser-native viewers
can consume a bounded full `200` response; byte-range support must either be
implemented and tested or explicitly deferred with the first PDF size limit.

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

### OQ-KVDEX — Kvdex atomicity and migration

Kvdex 3.6.7 is selected for the planned Deno KV page/content adapter because it
provides typed collections and segmented `Uint8Array` storage. It remains an
adapter dependency and must not enter domain or application interfaces.

Its encoded collections cannot participate in Kvdex atomic builders, and blobs
above Deno KV's 800 KiB atomic mutation limit require Kvdex batched writes that
are not one atomic visibility commit. The adapter must therefore stage immutable
unreferenced assets to completion before atomically publishing page/endpoint
references. Built-in index deletion also cannot replace the repository's
existing atomic rename/delete guarantees without proof. The current raw Deno KV
keyspace is not a Kvdex keyspace, so switching implementations requires explicit
compatibility or migration; silently presenting an empty database is not
acceptable.
