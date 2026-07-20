# Quality and technical requirements

## QT-STACK — Existing stack

- Product code uses strict TypeScript.
- The runtime is Deno.
- The web app uses Fresh with Preact and Vite.
- Site UI is designed mobile-first, with wider layouts added as progressive
  enhancements.
- `deno task check` is the minimum repository validation command.

The stack does not by itself decide storage, authentication, search, or safe
content delivery.

## QT-BOUNDARIES — Agnostic implementation boundaries

Product behavior should not depend on replaceable integration choices where a
stable domain boundary is practical:

- locator operations use a namespace and optional page name without assuming a
  path, subdomain, or other public URL mapping;
- an HTTP routing boundary maps requests and generated URLs to that locator
  model;
- publishing and management behavior is shared by the site and API rather than
  implemented separately for each interface;
- content bindings do not assume that all content always comes from one storage
  implementation;
- a logical page, immutable content asset, and delivery endpoint are separate
  contracts, so one asset can back several endpoint behaviors without duplicate
  page identity;
- publishers supply endpoint locators and delivery profiles through stable
  contracts; no content type generates or interprets a special path shape;
- authentication, search, and external provider choices do not define page,
  namespace, or access behavior.

A concrete deployment still selects integrations and a public URL mapping, but
those choices should not require rewriting the corresponding product rules.

`PageService` is the HTTP/session-independent application boundary for trial and
managed page behavior. It receives a typed actor and resolves namespace
authority through an interface, while persistence alone owns atomic endpoint,
ID, and revision conditions. Owner-safe summaries and inspection input exclude
stewardship IDs and stored derivations. The process-local composition now runs
this service through the named `PageAggregateRepository` capability. Explicit
`deno-kv-v2` composition selects the conforming kv-toolbox-backed aggregate only
after the source-preserving readiness probe passes; retained `deno-kv` selection
uses the legacy `PageRepository` compatibility path. The service and strict HTTP
boundary are still exposed once, and Fresh collection/item/direct routes remain
thin adapters. Public exploration extends that boundary through
`PublicPageExplorer`: callers supply optional name queries and an opaque
continuation, while the selected persistence decides whether the MVP scan or a
future index satisfies it.

The endpoint foundation exposes a transport/storage-neutral
`PageEndpointPlanner` interface and default implementation. It accepts one
explicit canonical binding plus up to seven alternates, validates every locator
through a narrow capability, enforces one namespace and case-insensitive claim
per binding, applies the selected content type's supported profile declaration,
and returns detached, deterministically ordered intent. `md-page` declares
inline-only delivery.

The persistence foundation now adds immutable `ContentAsset` identity, creation,
and read capabilities plus a separate `PageAggregate` with one asset reference
and a complete endpoint set. The named `PageAggregateRepository` composes the
focused endpoint resolution, trial/managed creation, revision-bound combined
mutation, duplication, deletion, and logical query capabilities without making
web or content types depend on its implementation. Asset creation is a staging
operation; only a fully created asset can enter an atomic page/endpoint commit.
The memory reference and shared backend-neutral conformance cover complete
endpoint claims/moves, content-reference flips, immutable sharing, concurrency,
and retention after page deletion. Focused managed/public query capabilities
return logical page aggregates rather than endpoint rows.

`PageService` now stages each validated `md-page` representation as an immutable
asset before atomic page publication, resolves direct requests through endpoint
bindings, materializes management/public projections from the aggregate plus its
asset, and keeps access-only changes on the existing asset. Owner/public
summaries retain canonical compatibility fields and expose the complete set as
safe application-relative links. Direct delivery carries the exact resolved
binding, rejects content-handler/profile incoherence, and maps the stored
profile to inline or attachment disposition; filename hints never override it.
Application commands accept either the one-inline-locator compatibility shape or
complete endpoint intent. Complete updates are revision-bound and no-op when
only alternate input order changes; canonical rename retains alternates; and
endpoint-aware duplication requires a fresh planned set. The legacy repository
path rejects non-compatible sets rather than truncating them. Fresh, `Request`,
`Response`, multipart parsing, browser preview, Deno KV, and kv-toolbox types
remain outside the split contracts.

## QT-STORAGE — Repository persistence

Each durable adapter must preserve its repository contract and pass the same
implementation-agnostic conformance suite as the in-memory reference. Storage
keys, indexes, serialization versions, transactions, and drivers remain inside
the adapter; services and domain models do not depend on them.

The first durable option is an ownership bundle backed by Deno KV. It persists
application users and provider identities atomically and persists a namespace
claim with its owner index in one atomic commit. These repositories are selected
together because a durable namespace claim pointing at a process-local user ID
would become orphaned after restart. Unset configuration retains both in-memory
repositories.

Session persistence is a separate opt-in behind the same `SessionRepository`
contract, but a Deno KV session must inherit a configured Deno KV ownership
database. Startup rejects durable sessions with memory ownership, preventing an
authenticated session from outliving its user. Session creation, renewal,
one-use authentication attempts, credential rotation, logout, and revocation
remain atomic. Records and credential-hash indexes carry the absolute-session
TTL; service checks remain authoritative because KV expiration is lazy.

Page persistence is a third opt-in and follows the session rule: durable pages
require the configured Deno KV ownership database, because a page in a reserved
namespace must not outlive the reservation and user that authorize it. The
composition root accepts the named aggregate or retained compatibility
interface. The retained `IAM_PAGER_CONTENT_STORAGE_BACKEND` variable selects
`memory`, schema-v1 fallback `deno-kv`, or readiness-gated aggregate
`deno-kv-v2`; both durable choices inherit the ownership path.

`DenoKvPageRepository` currently uses a fresh schema-versioned keyspace with one
authoritative envelope by stable page ID, case-normalized locator and ordered
owner indexes, and immutable content generations split into bounded chunks.
Content writes finish their chunks before an atomic visibility commit updates
all envelopes and indexes; access-only updates and rename retain the exact
generation, while rename moves both indexes with the envelope revision in one
commit. Duplication writes a fresh generation and conditionally checks the exact
source revision and generated destination; content updates, trial replacement,
managed takeover, and deletion remove the replaced visible generation in the
same commit. The tagged JSON codec round-trips plain structured data and
`Uint8Array`. Reads validate key/value identity,
stewardship/access/revision/date/meta fields, index coherence, chunk
order/count/length, codec shape, and schema version; impossible or unknown
states are corruption. Conditional retries are bounded, and failed visibility
conditions clean unreferenced new chunks best-effort. Neither ownership nor
session settings alone imply that pages survive a restart; only the explicit
page-storage opt-in selects durable page persistence.

`MemoryPageAggregateRepository` is the reference for the split model. Its
synchronous check/set phases atomically update the logical page and every
case-insensitive endpoint index, while immutable assets are cloned at boundaries
and never overwritten or deleted by page operations. Managed/public query
capabilities sort and cursor logical pages by their canonical locator, so
alternates cannot duplicate rows. `MemoryPageRepository` is now only a
one-endpoint compatibility projection over that reference, and the composed
process-local `PageService` detects and uses the focused capabilities directly.
`KvPageAggregateRepository` is the durable implementation of the same named
contract. It stores one strict authoritative envelope in an adjacent
`page-aggregates/v2` keyspace, revision-bearing case-normalized endpoint claims,
and ordered canonical owner/public projections. Assets publish first; each page
mutation checks the strict manifest entry and commits the envelope plus every
endpoint and projection through one native atomic operation. Reads validate
schema, key/value identity, endpoint completeness, revision coherence, and
projection eligibility. Conditional retries are bounded, while commit exceptions
remain ambiguous and are propagated rather than replayed blindly. The maximum
supported duplication/takeover shape—eight source endpoints and eight
eight-endpoint trials—uses 87 of Deno KV's 100 atomic checks, leaving 13 checks
of tested headroom. Shared conformance plus reconstruction, malformed
record/index, manifest, rejected-commit, exhaustion, and maximum-transaction
coverage pass. Explicit `deno-kv-v2` composition now selects this repository
after the source-preserving readiness gate passes. The raw-Deno-KV
`PageRepository` remains available only through the `deno-kv` fallback profile.

The required Deno KV utility is exactly pinned `@kitsonk/kv-toolbox` 0.31.0. The
project-owned gateway is implemented, and selected identity, namespace, session,
legacy-page, and manual-schema adapters now depend on its record interface
rather than receiving a raw handle. Its production implementation alone owns the
wrapper and database lifecycle. Ordinary operations delegate to the toolbox; the
package does not define domain models, repository contracts, page indexes,
migrations, or web responses.

The gateway's binary capability accepts detached non-empty bytes only at an
unused unreachable staging key. It delegates segmentation, then reconstructs and
verifies the exact byte length and value before reporting success; this catches
a later failed batch even when an earlier commit succeeded. Reads reject missing
chunks, truncation, or malformed metadata, and known failed staging is removed
best-effort. Contract tests cover 1 MiB and the accepted 16 MiB PDF bound, fresh
wrappers, interrupted later batches, retry, corruption, removal, and handle
closure. The versioned `v8-1` content-data codec is byte-compatible with the
retained prototype fixture and round-trips current Markdown/PDF data.

The earlier Kvdex asset prototype was never selected and has been removed with
its dependency. Its gateway-backed replacement snapshots caller-owned values,
encodes once with `v8-1`, stages under a random unreachable identity, and checks
length, SHA-256, decoding, and domain coherence before publishing one strict
schema-v1 manifest with native compare-and-set. Known CAS losses remove staging
best-effort; an ambiguous manifest exception retains the payload because a
successful commit may reference it. Every read repeats manifest, blob, length,
hash, codec, and domain checks. Cross-instance, contention, corruption,
interrupted-batch/retry, legacy-keyspace, and accepted 16 MiB PDF tests cover
the replacement.

Toolbox blob writes may span multiple commits, and `KvToolbox.atomic()` may
split an operation. They therefore cannot publish application visibility. The
project storage interface exposes an explicit native-atomic capability backed by
`toolbox.db.atomic()`; manifest, page, complete endpoint set, owner/public
index, and revision transitions use it for one commit over adapter-owned
records. The concrete wrapper is never supplied to repositories, preventing
accidental use of its batched atomic. Only a fully verified manifest-backed
immutable asset may be referenced by a page. Toolbox query and response helpers
do not replace deterministic repository indexes or the web-independent HTTP
adapter.

The replacement is selected only by the explicit `deno-kv-v2` profile. Existing
raw-KV schema-v1 page records have one retained, adjacent, repeat-safe
`pages-v1-to-v2` migration. Its strict source reader validates every visible
envelope, locator/owner index, and referenced chunk set while tolerating only
documented unreachable chunk residue. It maps each locator to one canonical
inline endpoint, derives SHA-256-based deterministic asset/payload identities,
reuses identical interrupted staging, verifies each manifest/payload/aggregate,
and publishes destination visibility conditionally without updating or deleting
a v1 key. Existing different v2 data fails as a conflict.

A strict readiness record binds the migrated page count and source fingerprint.
The read-only `PageAggregateReadinessProbe` recomputes that fingerprint and
revalidates every destination asset and aggregate; it refuses missing migration
state, non-empty unmigrated v1, post-migration v1 changes, source corruption,
missing manifests, and destination conflicts. The page factory invokes it only
when `deno-kv-v2` is deliberately selected, closes the unused gateway on
failure, and never runs migration. Startup/deploy hooks remain free of database
work; retained `deno-kv` composition stays on the v1 compatibility path.

Deno KV ownership records have no application expiry or deletion workflow yet.
Changing backend or database path performs no migration, and backup/recovery is
the responsibility of the configured KV service or deployment operator. Session
records expire through their bounded lifecycle, and page records live until
replaced or deleted through publishing. A crash between chunk writes and the
envelope flip can orphan chunks of a never-referenced generation; they are
invisible to readers and harmless, but no sweeper reclaims them yet. These
operational limits must remain visible until broader lifecycle and migration
behavior is delivered.

## QT-PREDEPLOY — Local verification and manual database health

Formatting, lint, type checks, and the complete tests are developer-side push
checks, not deployment work. A tracked native `pre-push` hook runs
`deno task verify`; GitButler `but push` and `but pr new` execute that hook by
default. The hook is intentionally installable per clone rather than replacing
`core.hooksPath`, which would interfere with GitButler-managed hooks. It can be
explicitly bypassed, so this is a repository workflow assumption rather than a
CI-backed guarantee. Deno Deploy performs its normal build once.

`deno task pre-deploy` is intentionally only an informational `echo`. It always
succeeds, opens no database, reads no environment, and runs no check, test,
build, manifest write, or migration. Build, deploy, application startup, and
requests have no release-manifest dependency. The task exists only because the
deployment platform has a useful pre-deploy slot that may gain different work
later.

Database release health is checked manually with `deno task db:check` against an
explicit `--database` local path or Deno KV connector URL. Remote access reads
`DENO_KV_ACCESS_TOKEN` only from the environment. Missing target/token,
connection failures, absent or malformed metadata, wrong project, stale/future
versions, and missing/unknown schemas produce bounded, descriptive diagnostics
and the safe next action. A healthy check exits zero; every other state exits
nonzero. This command is deliberately absent from `verify`, build, deploy, and
runtime.

One authoritative database manifest still binds a database to project
`iam-pager` and a complete sorted `ownership`/`pages`/`sessions` version vector.
Manifest absence means unversioned; it never wildcard-matches data. Existing
application values retain and validate their own record schema versions at
runtime. The current unversioned baseline is record format 1 for every schema.
Because absent metadata cannot prove project identity, initializing it requires
both an explicit target and `--confirm=iam-pager`.

`deno task db:update` is the only generic schema mutation entrypoint. It derives
project and target versions from code, first prints the same inspection, and
refuses wrong-project, future, missing, unknown, unsupported, malformed, or
unconfirmed state without writing. Developers no longer transcribe complete
`from` and `to` vectors. Each target bump must retain one adjacent, descriptive,
repeat-safe migration in `lib/database-schema/current-schema.ts`; registry gaps
fail before opening a database.

The manual runner intentionally has only a manifest-store interface, a small
forward migration registry, and one final compare-and-set manifest publication.
It has no deploy integration, per-schema coordination records, pending claims,
leases, contention loop, inferred diff, down migration, or rollback framework. A
failed migration leaves the old manifest and may leave repeat-safe data work to
rerun. A concurrent manifest change fails publication and requires another
manual check. Destructive changes still require staged expand/deploy/contract
releases and an operator-managed backup.

The immutable registry now declares ownership and sessions at version 1 and
pages at version 2. Confirmed initialization or a pages-v1 manifest runs the
retained source-preserving `pages-v1-to-v2` migration before publishing that
complete vector. Operators must back up and quiesce v1 page writers before the
update and keep them stopped through readiness verification, explicit
`deno-kv-v2` selection, and smoke testing. A later v1 write changes the
readiness fingerprint and is refused rather than overwritten; retained v1
records provide a fallback window, not a rollback claim.

Deno Deploy currently uses Deno 2.5.0 for both builder and runtime, so the
project toolchain and formatting are pinned to that version. Runtime storage
selection now follows configured backend variables directly in every context;
there is no `DENO_TIMELINE` override. Operators must explicitly keep shared
revision-preview databases in memory or ensure cross-revision record
compatibility. Git branch timelines with isolated databases remain the safer
durable review target.

## QT-ROUTING — Routing and HTTP behavior

- Namespace and page matching must follow `DA-LOCATOR` consistently during
  publishing and retrieval.
- Locator uniqueness and replacement rules must remain correct when requests
  arrive at the same time.
- Page routes must not consume management, API, framework, or static-asset
  routes.
- A complete endpoint plan contains 1–8 bindings, exactly one structurally
  canonical, all in one case-insensitive namespace and all unique in the shared
  locator collision space; set replacement commits completely or not at all.
- Direct responses must use an intentional status, content type, length, cache
  policy, and stored inline or download disposition.
- Invalid and missing direct URLs must not masquerade as a successful home-page
  response.
- Content updates must not expose a new payload with stale metadata or the
  reverse.

The current prototype maps `/` and `/site/*` to the site, reserves `site`,
`api`, and `auth` as namespaces, and maps every other unclaimed path through the
path-slug locator strategy. Replaceable guest content uses `no-store` until
validators exist. Active HTML and SVG delivery must receive an origin-less
sandbox and a restrictive content security policy in addition to content
sanitization.

## QT-CONTENT — Content handling

- The accepted formats and size limits must be explicit.
- Text and binary content must both be possible within the supported set.
- The service must not trust a filename alone to choose a media type.
- Upload and delivery should avoid unnecessary whole-file buffering when larger
  supported content makes that impractical.
- Active formats such as HTML and SVG need a delivery boundary that prevents
  them from reading or changing authenticated management state.
- Unsupported or unsafe-to-preview content can be downloaded instead of embedded
  in the site view.

The first supported set can be small, but the design should not assume that all
future pages are short text. Content handlers declare a non-empty subset of the
fixed `inline` and `attachment` endpoint profiles; the implemented `md-page`
handler permits only `inline`. The implemented transport-independent `pdf`
handler permits both. It accepts detached `Uint8Array` input up to 16 MiB,
requires a byte-zero PDF 1.0–1.7 or 2.0 header and a terminal
`startxref`/`%%EOF` whose offset targets an xref table or indirect xref-stream
object, fixes media type to `application/pdf`, and never trusts a filename
extension to establish type. The required portable filename is at most 255 UTF-8
bytes and excludes path separators, controls, bidirectional overrides, unsafe
portable characters, and common reserved-device names. This minimum screen is
not sanitization, exploit detection, or malware certification.

The handler clones accepted, derived, and rendered byte views, exposes only
filename/media-type/size/version/replace capability to management inspection,
and declares independently configured inline and attachment endpoints at
ordinary valid locators. Browser-native direct viewing and a site wrapper around
that URL are the first preview adapters; PDF.js, thumbnails, text extraction,
generic binary, and unbounded streaming are later. The HTTP adapter now owns
strict two-part multipart buffering under a stream-enforced 16 MiB-plus-64 KiB
body bound. Direct PDF delivery supports one byte range with `206`/`416`,
validators, and browser-native full-body fallback; ranges remain outside the
content core.

The current `MdPage` form previews Markdown and CSS locally inside a sandboxed
iframe, without a preview HTTP request. Its Page workspace is collapsible
without resetting the selected source or layout; Markdown and CSS are mutually
exclusive source panes. Markdown/CSS and Raw/Steps use attached tabs because
they replace interchangeable content immediately below them. Tabs expose
selected/control/panel semantics with roving focus and arrow, Home, and End
navigation. Split/full-width remains a detached segmented control because it
rearranges the same content rather than replacing it. `Split with preview`
places source and preview side by side where space permits, while `Full width`
places the preview below, and the preview can enter browser fullscreen. Markdown
has switchable raw and guided section editors backed by the same source string.
The guided adapter must losslessly derive sections from untouched source without
approximating a full Markdown parser: safe focused forms may stay one physical
line, unfamiliar Markdown remains a raw one-line section, and complete or
unterminated fenced code blocks are grouped as one multi-line section.

Collapsed sections are content-only previews rendered in isolated frames with
the current page CSS; activating one toggles its focused controls and closes the
previously active section, with unsaved changes guarded. Each card measures and
shows its whole rendered content by default, while a per-card Compact/Whole
preference follows source updates, focus changes, reordering, and removal. The
measurement frame permits same-origin inspection but still prohibits scripts;
the full-page preview retains its stricter opaque sandbox. Focused forms support
value-preserving safe type changes and integrate field-level Paste, Copy, and
Clear actions into quiet input headers. Code block sections expose optional
language and multiline code fields, generate a non-conflicting fence when
changed, and cannot convert to a one-line type while multiline content remains.
Text, Heading, Link, Code block, and raw Markdown are content types. For focused
one-line content, an `Is list item` checkbox enables an adjacent `Numbered`
checkbox on the same line; unchecked Numbered means bulleted. Empty Text
represents a blank physical line. Fenced code blocks remain standalone because
list-owned fences require coordinated indentation across the whole block.

New sections append at the end. A prefixed drag grip and visible insertion/final
drop indicators replace directional and contextual insertion buttons. Dropping
between cards reorders; dropping over a card's central merge target removes the
dragged card and combines its primary value with the destination, without
retaining the source Heading, Link, list, or code-block syntax. The destination
type remains authoritative: one-line fields use a space and Code block values
use a physical newline. The editor must not inject HTML break tags for this
operation. Pointer Events support mouse, touch, and pen, while focused grips
support keyboard arrow, Home, and End ordering with live announcements. Paste
must fall back to explicit manual entry when browser clipboard reads are
unavailable or denied. Structured editing is presentation logic only and does
not replace the publish input or server content handler. This draft
representation is intentionally simple; authoritative validation and
sanitization remain in the server-side content handler at publish time, keeping
Deno/server dependencies out of the browser module graph. CSS presets contain
element-oriented starting styles and replace the editable CSS draft when
selected. The CSS textarea remains the source while pinned CDN-hosted Prism
provides optional syntax highlighting.

## QT-LIMITS — Publishing limits

Publishing needs configurable content-size, stored-size, page-count, and
frequency limits. Guest publishing uses stricter values and may have shorter
retention. The app must explain when a limit rejects or removes content.

The current prototype bounds a guest publishing request at 96 KiB and accepts up
to 64 KiB of Markdown plus 16 KiB of optional CSS, measured as UTF-8 bytes. The
transport-independent PDF boundary accepts up to 16 MiB; the current JSON
request limit and shape intentionally provide no PDF upload path. These are
initial operational values, not a promise for every future content format. Total
stored-page capacity, publishing frequency, and guest expiry are still
unimplemented.

## QT-AUTHORITY — Authenticated boundaries

- A page mutation in a reserved namespace requires authority from that
  namespace's owner.
- Knowing a private page URL is not sufficient to read it.
- Unauthenticated publishing cannot replace a protected page.
- Site controls must not trust owner or namespace values supplied only by the
  browser.
- Session behavior must protect state-changing operations from unrelated sites
  and creator-supplied page content.

The session foundation keeps transport and storage separate. A browser bearer
credential is opaque; only its hash is stored. Every request reaching
application routing now resolves to a guest or authenticated server-side
session, never a caller-selected identity or a nullable state, and receives a
new server-owned request ID. Production uses an explicit secure host-only
cookie; localhost uses a distinct configuration selected by the development
command. Middleware adds only the request-ID and pending cookie headers,
preserving direct-content status, body, length, and CSP isolation.
Authentication preserves the logical session but atomically rotates its
credential. Generic browser start/callback routes use the provider-neutral
orchestrator, bounded query values, one-use state, validated local returns,
no-store responses, and diagnostics that omit callback values and raw provider
causes. Successful callback rotation is published by the central request
boundary so it supersedes a concurrently staged renewal cookie. Authentication
also issues a 256-bit synchronizer token outside the cookie. Bounded form-only
`POST /auth/logout` validates that token against the current repository record,
atomically revokes the authenticated bearer, and centrally publishes a distinct
fresh guest session and credential; stale, cross-session, and replayed requests
cannot revoke authenticated access. The pinned gauth 0.4.1 Google adapter keeps
its PKCE verifier server-side, maps only verified identity fields, discards
provider tokens, and prevents raw provider failures from crossing the strategy
boundary. Startup-validated configuration now explicitly composes the package's
local or original preset and registers Google. Local fake authentication keeps
its configured fallback callback and consent URLs restricted to same-origin
loopback; original mode requires client credentials and HTTPS outside loopback.
Either mode preserves the configured callback unless an optional bounded
request-host regex is set. Dynamic selection uses only the HTTPS `Request.url`,
requires a full case-insensitive host match including any port, builds the fixed
callback path through the URL API, and rejects mismatches before orchestration;
`Origin` and `Referer` are not trusted. Pattern-based local mode needs no static
URL variables: callback and mock consent are both built on the selected origin.
If optional fallback URLs are supplied, they remain a complete same-loopback
pair. The mock-consent boundary rejects callbacks that are not allowlisted and
same-origin. Authorization and token exchange use services configured with the
same selected callback URI, and no unbounded host cache is retained. Every
matched local-mode host deliberately exposes fake sign-in, so preview patterns
must be narrow and exclude production. The local route validates the exact
authorization query before serving gauth's package-rendered consent screen and
remains unavailable in original mode. The local integration covers sign-in,
logical-session upgrade, bearer rotation, authenticated resolution, logout to a
distinct guest, and rejection of both stale guest and stale authenticated
bearers. Callback failures use a provider-neutral presentation model and
restrictive site-owned HTML response with a validated local retry link; the
consumed attempt cannot be replayed, the guest session remains available, and
callback values and provider causes remain absent. The site header receives a
complete model from an interface-backed server presenter: guests get a Google
start link with a validated local return, while authenticated sessions get only
signed-in state and the fixed CSRF-protected logout form. UI components receive
neither session/user IDs nor responsibility for deciding the available action.
The default session repository is process-local and invalidates sessions on
restart; configured Deno KV can preserve sessions only alongside durable
ownership. Authentication establishes user identity only: namespace reservation
and publishing authorization remain explicit services above it. Those services
now enforce concurrency-safe ownership, and configured Deno KV can preserve the
provider identity, application user, namespace claim, and opted-in session
across restarts. An authenticated JSON API and server-owned site presenter
expose reservation listing and CSRF-protected claiming; publishing derives the
actor from the resolved request session so only the owner can write into a
reserved namespace. See
[session-and-authentication.md](session-and-authentication.md).

The `auth` namespace is reserved alongside `site` and `api`, so authentication
routes cannot collide with direct page locators.

## QT-API — API behavior

- Direct content delivery and publishing use documented HTTP behavior.
- Site and programmatic publishing apply the same locator, content, access, and
  limit rules.
- Errors should be useful to both a browser and a programmatic client.
- The selected HTTP mapping must keep API endpoints and direct page locators
  unambiguous.

Random namespace and page-name suggestions are presentation-only and do not
change locator rules or query server availability. Their quiet actions belong to
the input header rather than competing with the locator fields as standalone
buttons. The current overwriteable guest flow has no locator availability
endpoint, so numeric fallback only avoids a combination already generated in the
local UI.

Authenticated namespace ownership uses `GET /api/namespaces` to list the
caller's claims and `POST /api/namespaces` with required string `namespace` and
`csrf_token` fields to claim one. The synchronizer token must match the resolved
authenticated session. Creation returns `201`, a direct-path `Location`, and a
reservation with its namespace, path, and ISO timestamp. Unauthenticated calls
return `401`; invalid CSRF and platform namespaces return `403`; malformed and
oversized bodies return `400`/`413`; unsupported media types return `415`; taken
names return `409`; invalid locator names return `422`. Responses use
`no-store`.

The composed page-management HTTP adapter serves `POST`/`GET /api/pages`,
`GET`/`PATCH`/`DELETE /api/pages/:page_id`, revision-bound
`POST /api/pages/:page_id/(rename|duplicate)` actions, and
`POST /api/pages/bulk/(access|delete)` commands. Creation uses nested
locator/access/tags/content input and session-derived trial-versus-managed
semantics; authenticated mutation requires the shared constant-time CSRF header
check, and a stale creator header on a guest session cannot downgrade into trial
publication. Authenticated list/inspect output excludes owner IDs, source from
lists, and stored derivations. PATCH and DELETE require one canonical strong
page/revision ETag, mapping missing, malformed, and stale preconditions to
`428`, `400`, and `412`. JSON bodies, item IDs, query names/counts/lengths,
limits, and cursors are bounded and strict. All management/error responses are
no-store. The exact public contract is documented in
[`docs/api/pages.md`](../api/pages.md); the superseded flat endpoint and its
locator-only application/storage path have been removed. Managed list queries
accept AND-combined name/access/tag filters, PATCH can replace or clear tags,
and the public site GET form projects exact-tag exploration.

Bulk access and deletion retain their HTTP-independent service boundary behind
strict routes. They accept only 1-100 distinct, syntactically valid page
ID/positive-revision pairs and validate the complete selection before mutation.
Accepted items execute in selection order with current owner/namespace authority
and repository revision conditions; one item failure does not roll back another.
Access successes retain content and tags, increment once, and use one shared
bulk-operation timestamp. Results preserve input order and collapse missing,
foreign, and unauthorized pages to the same item-level `not_found` outcome.

The PDF API does not base64-encode bytes into the JSON content command. Its
HTTP-edge decoder accepts exactly one `metadata.json` `application/json` part
(up to 16 KiB) and one named `application/pdf` file part (up to 16 MiB) inside a
stream-enforced 16 MiB-plus-64 KiB multipart request. Metadata carries the
publisher-supplied canonical-inline and attachment-alternate locator/profile
set; no route appends `.pdf` or manufactures an endpoint. Managed replacement
remains CSRF- and exact-revision-bound and can preserve or atomically replace
the complete set. Inspection returns safe PDF metadata and replacement
capability, never bytes or storage IDs. Direct delivery supplies opaque revision
ETags, `Accept-Ranges`, strict single-range `206`/`416`, and endpoint-specific
content disposition over byte-identical bodies. The JSON `md-page` contract
remains compatible.

## QT-SEARCH — Search and privacy

- Private pages and their content must not appear in public search.
- Guest pages must not appear in public search or browsing; they are reachable
  only by their direct URL for raw preview.
- A change from public to private must remove the page from exploration within a
  stated practical delay.
- Content indexing applies only to supported textual representations.

The first implementation searches current page state rather than a secondary
index, so public-to-private changes are reflected in the next query with no
indexing delay. Namespace and page-name matching uses normalized lowercase
substrings; tag matching is exact against the canonical stored set; supplied
fields use AND semantics. Results follow the existing locale-independent locator
order and are bounded by opaque cursors tied to the complete query scope. Both
repositories run the same eligibility, filtering, pagination, and
cursor-isolation conformance cases. The memory adapter filters its current
records; Deno KV scans its ordered locator index and re-resolves each
candidate's current envelope before eligibility. The contract deliberately does
not expose that implementation choice, allowing a secondary tag or text index
later.

Managed tag input is bounded before deduplication to ten values. The service
trims and lowercases 1–32 character ASCII tags, rejects characters outside
alphanumerics/`-`/`_`, and stores a sorted unique set. Replacing or clearing
tags uses the same exact-revision mutation as content/access; managed filter
cursors bind namespace, page-name substring, access, and tag together. Deno KV
persists tags in schema-v1 envelopes while reading older envelopes without the
optional field as untagged.

## QT-VERIFY — Verification

Tests should cover the behavior that defines the product:

- default and named page publishing and resolution;
- public direct delivery and private denial;
- protected namespace ownership and conflict rejection;
- limited, overwriteable publishing in an unreserved namespace;
- content-type and display or download behavior;
- publishing limits and capacity behavior;
- route conflicts and missing-page responses;
- page updates without mixed content and metadata;
- revision conflicts for concurrent update/delete intent;
- bounded bulk selection prevalidation, ordered partial results, and concurrent
  per-item revision conflicts;
- strict HTTP schemas, CSRF, pagination, and ETag preconditions;
- owner-only private delivery with an ordinary missing response for everyone
  else;
- the same identity, index, concurrency, and binary/large-content repository
  contract against memory and Deno KV;
- canonical bounded tag mutation and tag/name/access filter cursor isolation;
- exclusion of private and guest pages from exploration, including tag queries;
- one PDF asset resolving through inline and attachment endpoints with identical
  bytes and endpoint-specific headers;
- all-or-nothing endpoint-set create/rename, page-wide access, coherent content
  replacement, deletion, and single-row management/exploration;
- staged kv-toolbox multi-segment payloads never publishing an asset while
  incomplete or corrupt, durable aggregate reconstruction/corruption/contention
  behavior with all eight endpoints and native-transaction headroom, plus
  source-preserving migration from the existing raw Deno KV keyspace;
- strict bounded PDF upload, malformed/non-PDF rejection, safe filenames, and a
  browser preview/download acceptance flow.

The page-management and exploration suites cover these domain, repository,
service, presenter, component, composition, HTTP, and direct-delivery
boundaries. Final acceptance also exercises the composed local server through
guest trial publication, local authentication and namespace reservation, managed
takeover, private delivery, access PATCH, stale ETag, deletion, and logout.
