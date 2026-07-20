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

The new `PageService` is the HTTP/session-independent application boundary for
trial and managed page behavior. It receives a typed actor and resolves
namespace authority through an interface, while repositories alone own atomic
locator, ID, and revision conditions. Owner-safe summaries and inspection input
exclude stewardship IDs and stored derivations. This service runs against either
conforming page repository. The composition root selects the memory or Deno KV
adapter, exposes the service and strict HTTP boundary once, and Fresh
collection/item/direct routes remain thin adapters over those interfaces. Public
exploration extends that boundary through `PublicPageExplorer`: callers supply
optional name queries and an opaque continuation, while the selected repository
decides whether the MVP scan or a future index satisfies it.

The planned PDF work must evolve this boundary before adding transport code. One
logical page keeps one management/exploration representation while endpoint
resolution selects an inline or attachment delivery profile and then reads its
shared content asset. Fresh, `Request`, `Response`, multipart parsing, browser
preview, Deno KV, and Kvdex types must remain outside these contracts.

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
composition root selects `PageRepository` directly; the retained
`IAM_PAGER_CONTENT_STORAGE_BACKEND` variable now controls this page repository
for deployment continuity.

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

The planned replacement page/content adapter uses pinned Kvdex 3.6.7 only as an
implementation detail over Deno KV. It must satisfy the unchanged repository
contracts and shared conformance before becoming the selected durable adapter.
Kvdex encoded collections segment `Uint8Array`, but cannot join Kvdex atomic
builders; values beyond Deno KV's 800 KiB atomic mutation limit require batched,
non-atomic segment commits. Large immutable assets must therefore be staged
while unreferenced and become reachable only after all segments succeed and an
atomic metadata/endpoint commit publishes the reference. Critical locator and
owner indexes may not use Kvdex shortcuts whose delete/update behavior weakens
atomic rename, replacement, or deletion. Existing raw-KV records require an
explicit compatibility or migration path before selection changes.

Deno KV ownership records have no application expiry or deletion workflow yet.
Changing backend or database path performs no migration, and backup/recovery is
the responsibility of the configured KV service or deployment operator. Session
records expire through their bounded lifecycle, and page records live until
replaced or deleted through publishing. A crash between chunk writes and the
envelope flip can orphan chunks of a never-referenced generation; they are
invisible to readers and harmless, but no sweeper reclaims them yet. These
operational limits must remain visible until broader lifecycle and migration
behavior is delivered.

## QT-PREDEPLOY — Local verification and database release gate

Formatting, lint, type checks, and the complete tests are developer-side push
checks, not deployment work. A tracked native `pre-push` hook runs
`deno task verify`; GitButler `but push` and `but pr new` execute that hook by
default. The hook is intentionally installable per clone rather than replacing
`core.hooksPath`, which would interfere with GitButler-managed hooks. It can be
explicitly bypassed, so this is a repository workflow assumption rather than a
CI-backed guarantee. Deno Deploy performs its normal build once.

`deno task pre-deploy` is a small read-only database release gate. It validates
the linked durable storage configuration, opens the database attached to the
current timeline, reads its project/schema metadata, and succeeds only when the
stable project ID and every declared schema version exactly match code. Missing
metadata, a wrong project, stale or future versions, pending transitions,
corruption, unknown schemas, and mixed or memory repository profiles fail before
routing. The gate never initializes metadata, claims a step, rewrites data, or
reruns check, tests, or build. Application startup and requests still perform no
schema mutation. Deno Deploy executes pre-deploy with the selected timeline's
Production or non-production runtime context, never Build or Local. The latter
is named Preview in some dashboards and Development in current Deno
documentation; Local is reserved for `deno ... --tunnel`. Attached Deno KV is
exposed to the CLI as an injected remote default path and access token; the task
therefore grants those environment and dynamic endpoint network permissions
while the checker remains read-only.

One authoritative database manifest binds a database to a stable project ID and
a complete sorted version vector. Version `0` is not stored: it means only that
this manifest is absent, never “match any existing version.” Existing
application records remain in the `iam-pager` keyspace and retain their own
record schema versions; the manifest identifies the project and release-wide
schema targets without duplicating those fields into every value. The one-time
version-0 bootstrap cannot prove the identity of unversioned data, so its exact
remote database URL and project argument are an explicit operator assertion.
After bootstrap, project or version mismatch must perform no write.

Database mutation is a separate local developer command. It requires an exact
Deno KV connector URL, `DENO_KV_ACCESS_TOKEN`, the expected project ID, and
complete explicit per-schema `from` and `to` vectors. The request is validated
against both durable manifest and immutable code registry before the forward
runner can write. The accepted `api.deno.com` metadata endpoint may return
dynamic KV data endpoints, so the command's network permission cannot be safely
limited to the metadata hostname. Every `from` value must equal the manifest (or
all must be zero when absent), and every `to` value must equal code's target. A
successful runner publishes the target manifest only after every selected
transformation is complete; interruption leaves the old manifest stale so
pre-deploy remains blocked and the same idempotent command can resume. Because
the manual update must precede deployment of code that requires its target,
every data-changing helper must remain compatible with the currently running
release until that release is drained. Destructive changes require staged
expand/deploy/contract transitions rather than one in-place helper.

The schema-upgrade core remains storage-agnostic and interface-first. A stable
schema ID has one current version, one target, and contiguous adjacent
forward-only helpers. Plans and initial states are preflighted before writes;
claims and completion are exact; missing helpers, gaps, downgrades, future
states, unknown pending IDs, corruption, and non-converging contention fail
closed. There are no down steps, inferred diffs, rollback logs, or automatic
remote writes.

Deno KV is the first manifest/state implementation. Adapter-owned versioned keys
and versionstamp checks preserve conditional manifest publication, transition
claims, and matching completion. A claim is resumable coordination, not a
process lease, so helpers remain repeat-idempotent and concurrency-safe. Deno KV
types remain outside core contracts and output is bounded to project/schema IDs,
versions, steps, and outcomes.

The immutable registry currently declares `ownership`, `sessions`, and `pages`
at version 1. A remote database without a manifest is version 0 even when its
legacy application records already use record format 1; the explicit `0 -> 1`
bootstrap installs coordination state and the manifest without changing those
records. Later target bumps must retain every required helper.

Deno Deploy currently uses Deno 2.5.0 for both builder and runtime, so the
project toolchain and formatting are pinned to that version. Revision preview
URLs currently share one preview database and skip pre-deploy; the composition
root therefore forces all three application repositories to memory whenever
`DENO_TIMELINE` starts with `preview/`. They are stateless UI/warmup surfaces,
not durable-schema acceptance. Git branch timelines retain configured storage,
receive isolated databases, and execute pre-deploy, so database-dependent review
uses branch URLs. The three backend selectors may apply to All contexts: the
current Build does not compose storage, revision-preview composition still
forces memory, and Local deliberately selects the tunnel-provided Deno KV when
running `deno ... --tunnel`. Operators who require tunneled local process-memory
repositories instead scope the selectors to Production and the non-production
runtime context (Preview in some dashboards, Development in Deno documentation).

## QT-ROUTING — Routing and HTTP behavior

- Namespace and page matching must follow `DA-LOCATOR` consistently during
  publishing and retrieval.
- Locator uniqueness and replacement rules must remain correct when requests
  arrive at the same time.
- Page routes must not consume management, API, framework, or static-asset
  routes.
- Canonical and alternate endpoint locators share the same collision space; an
  endpoint set is created or moved completely or not at all.
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
future pages are short text. PDF is the selected next type. Its handler receives
bounded bytes independently from HTTP, verifies the explicit minimum PDF shape,
fixes media type to `application/pdf`, and never trusts a filename extension to
establish type. One asset supports independently configured inline and
attachment endpoints at ordinary valid locators. Browser-native direct viewing
and a site wrapper around that URL are the first preview adapters; PDF.js,
thumbnails, text extraction, generic binary, and unbounded streaming are later.
The wrapper must retain direct-preview and download fallbacks, and the first
slice must explicitly decide whether HTTP byte ranges are implemented or
deferred under a bounded size.

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
to 64 KiB of Markdown plus 16 KiB of optional CSS, measured as UTF-8 bytes.
These are initial operational values, not a promise for every future content
format. Total stored-page capacity, publishing frequency, and guest expiry are
still unimplemented.

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

The planned PDF API must not base64-encode bytes into the existing JSON content
command. A strict bounded multipart or dedicated upload decoder belongs at the
HTTP edge and produces the transport-independent PDF input. Its metadata carries
the publisher-supplied endpoint locator/profile set; no route appends `.pdf` or
otherwise manufactures an endpoint. Managed replacement remains CSRF- and
exact-revision-bound; inspection returns safe PDF metadata and replacement
capability, never the full byte payload in JSON. Create, inspect, and public
representations return the complete canonical/preview/download link model
without exposing storage IDs. The current JSON `md-page` contract remains
compatible.

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
- staged Kvdex multi-segment assets never becoming reachable while incomplete,
  plus compatibility or migration from the existing raw Deno KV keyspace;
- strict bounded PDF upload, malformed/non-PDF rejection, safe filenames, and a
  browser preview/download acceptance flow.

The page-management and exploration suites cover these domain, repository,
service, presenter, component, composition, HTTP, and direct-delivery
boundaries. Final acceptance also exercises the composed local server through
guest trial publication, local authentication and namespace reservation, managed
takeover, private delivery, access PATCH, stale ETag, deletion, and logout.
