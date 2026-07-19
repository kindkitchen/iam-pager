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
case-insensitive substring search over author namespaces and page names. Either
field can be used alone; together they use AND semantics. Default pages have no
page-name value and therefore match browsing or namespace search only. Private
and guest pages are excluded from current storage state before results cross the
public contract.

Tags join when expanded management supplies them. Text-content extraction and
indexing, relevance ranking, and view-count sorting are not part of this MVP
slice. The `PublicPageExplorer` boundary permits a later index without changing
locators, site-view links, or visitor-safe result summaries.

### OQ-API — API surface

The first concrete page API is settled as `POST`/`GET /api/pages` and
`GET`/`PATCH`/`DELETE /api/pages/:page_id`, with strict nested JSON, browser
session authentication, synchronizer-token CSRF for authenticated mutations,
opaque pagination, and strong revision ETags. Direct retrieval remains the
locator URL. External bearer credentials and expanded management operations are
later scope; see [`docs/api/pages.md`](../api/pages.md).

## OQ-OPEN — MVP decisions still needed

### OQ-CONTENT — Supported content

Choose the first media types and size bands. For each type, decide whether the
direct response displays it, downloads it, or can do either. Active HTML, SVG,
and scripts need an explicit isolation choice before they are served.

The initial set can be narrow, but it should test both textual and binary
content so the app does not become accidentally text-only.

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
later.
