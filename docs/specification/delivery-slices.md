# Delivery slices

These slices are app outcomes rather than numbered requirement markers, so they
can be split or rearranged as the product is refined.

## DS-PUBLISH — Publish and open a page by URL

A publisher can submit a namespace, optional page name, supported content, and
delivery metadata through a small API and site flow. The app returns a direct
URL, and a visitor opening it receives the current content without the site
wrapper.

The slice proves default and named locators, supported text and binary formats,
content metadata, size handling, and intentional missing-page behavior. An
unregistered guest may use the flow under stricter limits and without reserving
the namespace.

## DS-PROTECT — Protect and manage a namespace

A creator can authenticate and reserve a unique namespace. Reservation prevents
guest or cross-user replacement and gives the creator control over default and
named pages.

The creator can create, inspect, update, make public or private, and delete
pages. Visitors can directly open public pages; private pages remain limited to
the creator session.

The API-first core of this slice is composed: Fresh exposes collection, item,
action, and bulk management routes over the selected page repository, and direct
delivery uses the same page service with session-derived authority. The site
projects that boundary as a creator management panel without adding management
rules to the web layer. It covers filter-bound listing and continuation,
inspection, content/tag editing, revision-bound individual access changes,
rename, duplicate, confirmed deletion, and explicit bounded bulk access/delete
selection with per-page outcomes.

## DS-VIEW — Present a page through the site

A visitor can open a public page in a thin site wrapper, continue to its direct
content, visit the creator's default page, and see other public pages. Supported
content is previewed without confusing it with the platform UI; other content
has a suitable download or fallback view.

This slice is composed at `/site/<locator>`. A web-independent public-view
contract resolves eligible pages and creator-default pages, while a
visibility-scoped repository operation paginates only public managed pages in a
namespace. Memory and Deno KV satisfy the same contract. The Fresh route is a
thin projection: supported HTML is confined to a sandboxed, no-referrer iframe;
unknown formats receive a direct-content fallback; trial pages can be viewed by
known locator but never acquire creator listings; private and missing pages
share a real 404 response.

## DS-EXPLORE — Explore public pages

The first exploration slice is composed on the site: visitors can browse public
managed pages or search by case-insensitive namespace and page-name substrings,
independently or with AND semantics. Results are deterministic, bounded, and
continued by an opaque cursor bound to the complete query scope; each opens the
DS-VIEW wrapper and its direct/default/other-page links.

`PublicPageExplorer` keeps this behavior outside Fresh. Memory and Deno KV scan
their current locator state behind the same repository contract and conformance
suite, excluding private and guest pages before any result is returned. The
explorer also accepts one exact canonical tag, AND-combined with either name
query and bound into continuation cursors. The web form exposes all three fields
and shows canonical result tags. Text-content search, indexing, relevance, and
view-count sorting remain later work.

## DS-MANAGE — Expand authenticated management

The creator can filter managed pages, rename without conflicts, duplicate with a
generated name, apply selected bulk changes, and reserve additional namespaces.

Date and view filters are added only when the corresponding metadata is useful
and trustworthy.

The HTTP-independent DS-MANAGE core now includes revision-bound rename and
server-generated duplication plus bounded page tags. A managed page carries at
most ten canonical tags; create normalizes them, update can replace or clear
them at an exact revision, rename preserves them, and duplicate copies them.
Managed listing supports AND-combined page-name substring, exact access, and
exact tag filters in addition to namespace, with continuations bound to the
complete filter scope. Memory and Deno KV pass the same mutation, filtering,
pagination, and cursor conformance; older schema-v1 KV pages read as untagged.
The raw service also exposes bounded bulk access and deletion interfaces: each
command prevalidates 1-100 distinct page ID/revision pairs, applies accepted
items independently under current ownership and exact revisions, and preserves
selection order in one result per page. A failed item does not roll back another
item; malformed selections cannot partially mutate. Strict Fresh routes expose
managed tags and filters, revision-bound rename/duplicate actions, and bulk
access/delete with browser-session authentication, synchronizer CSRF, and source
revisions. The creator panel now projects the complete slice:
name/access/exact-tag filters stay bound through pagination; content and
comma-separated tags save together; rename supports a named or default
destination; duplicate inserts the generated result when it matches the active
filters; and explicit selection uses the visible rows' current revisions for
bounded bulk access or deletion. Every accepted bulk item gets a visible
outcome, while conflicts refresh the affected row.

## DS-PDF — Publish one PDF page with preview and download endpoints

This planned slice separates a logical page, immutable content asset, and
endpoint bindings before adding PDF. A PDF page has one canonical management and
exploration identity while its same stored bytes are reachable through
independently configured inline browser-preview and attachment endpoints. Every
locator is ordinary publisher intent validated by the locator boundary; PDF does
not generate or reserve a special path shape. Creation, access, endpoint-set
change, replacement, duplication, and deletion preserve the complete endpoint
set without partial visibility.

The generic prerequisite now includes pure endpoint-set planning, immutable
content assets, an atomic page/endpoint aggregate, logical-page query
capabilities, the process-local reference, and shared persistence conformance.
`PageService` uses that split path for current `md-page`: validated content is
staged before publication, each page has one canonical inline endpoint, direct
resolution joins its current asset, and management/public queries emit one row.
Owner/public summaries now add a safe complete endpoint link set while retaining
canonical locator/path compatibility; site projections show alternates without
creating rows. Direct HTTP uses the exact resolved profile for inline versus
attachment disposition. The generic prerequisite is complete. The
transport-independent PDF content core is now implemented: it validates and
detaches at most 16 MiB, fixes media type, retains safe filename/version
metadata, declares both profiles, and keeps bytes out of management inspection.
Generic application endpoint-set commands are now complete: create and
revision-bound update plan the full set, canonical rename retains alternates,
and endpoint-aware duplication requires a fresh full destination set. Durable
persistence now has its first kv-toolbox checkpoint: exact `@kitsonk/kv-toolbox`
0.31.0 is behind one project-owned KV gateway, and every selected Deno KV
adapter plus manual schema tooling consumes that interface. Its production
implementation alone owns the wrapper and exposes an explicit native-atomic
capability backed by `toolbox.db.atomic()`. Verified binary staging covers
detached 1 MiB and 16 MiB values, reconstruction, later-batch failure
cleanup/retry, malformed or truncated state, and removal. The explicit `v8-1`
codec remains compatible with the prototype payload fixture. The rejected
unselected asset prototype and Kvdex dependency are now removed: its replacement
snapshots input, stages encoded payloads under random identities, verifies
length/SHA-256/codec/domain coherence, and publishes one strict manifest with
native CAS. Reads reverify all integrity fields; known races clean staging and
ambiguous commit exceptions retain possibly referenced payloads. Cross-instance,
contention, corruption, interrupted-batch/retry, legacy-keyspace, and accepted
16 MiB PDF coverage pass. The named aggregate repository now also has a durable
v2 implementation with manifest-backed envelopes, revision-bearing endpoint and
owner/public indexes, and one native visibility commit. Shared conformance,
restart/corruption/retry-exhaustion coverage, all eight endpoints, and the
worst-case 87-of-100-check transaction pass. The manual source-preserving
raw-keyspace migration now validates and retains v1, copies deterministic
assets/aggregates into v2, rejects conflicts and source changes, and exposes a
strict readiness probe. Explicit `deno-kv-v2` composition now gates and selects
the aggregate while `deno-kv` preserves the v1 fallback. Strict HTTP delivery is
now complete: create and revision-bound replacement accept one bounded
metadata/PDF multipart pair, require publisher-configured canonical-inline and
attachment-alternate endpoints, and direct delivery provides opaque validators
plus strict single-range `206`/`416` over byte-identical responses. The
secondary site publishing projection now has a raw content-type/file-selection
model, advisory filename/size feedback, explicit ordinary endpoint/profile
controls, multipart submission, and typed API failure presentation. Creator
management now derives preview/download actions from returned endpoint profiles,
validates bounded PDF metadata without bytes, and sends replacement as one exact
revision-bound multipart request while retaining the selected file across
failure or stale refresh. The public wrapper now embeds the canonical inline
endpoint with browser-native PDF support and keeps Back, direct-preview,
attachment-download, and unsupported-browser fallback navigation available.
Exploration still projects one logical PDF row with content type and size.
Generic binary fallback and external storage remain later.

## DS-EXTERNAL — Evaluate external storage

After first-party publishing is stable, one external provider can test whether a
page should copy, serve, synchronize, or redirect to provider content. The
evaluation must preserve the locator behavior and namespace protection already
visible to users.
