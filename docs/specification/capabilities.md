# Capabilities

## CP-DELIVERY — Direct content delivery

For a known locator, the app can:

- resolve the namespace and optional page name consistently;
- return current public content without the site's visual wrapper;
- return intentional media type, size, caching, and display or download
  behavior;
- authorize private pages before returning content;
- distinguish successful delivery from invalid, missing, private, and
  temporarily unavailable outcomes;
- handle content without allowing it to interfere with management sessions or
  platform routes;
- apply the stored endpoint delivery behavior, such as inline or attachment,
  without inferring it from a URL suffix at response time.

Direct retrieval is part of the public HTTP/API surface, not merely a link into
the site UI.

## CP-PUBLISH — Publishing

The app can:

- accept a namespace, optional page name, supported content, access choice, and
  required delivery metadata;
- validate the locator, content, and limits;
- create a page and return its direct URL;
- update content without exposing a partially changed page;
- apply the same publishing rules through the site and programmatic API.

An authenticated creator publishes inside a reserved namespace. Even a guest may
publish with stricter limits, but without namespace reservation or overwrite
protection.

## CP-PDF — PDF content and delivery endpoints

The PDF capability now has a transport-independent content core that:

- validates and detaches PDF input up to 16 MiB with explicit version,
  terminal-structure, and portable filename rules;
- fixes media type to `application/pdf`, declares inline and attachment support,
  and projects bounded owner metadata without payload bytes;
- composes with immutable content assets independently from locator bindings and
  resolves the same exact bytes through already-established generic inline and
  attachment endpoint contracts.

The generic application core now:

- binds one logical page to complete user-configured endpoint intent, including
  inline and attachment profiles;
- validates each supplied locator through the ordinary locator interfaces and
  keeps endpoint persistence behind interfaces, without PDF-specific path
  generation;
- applies access, content and endpoint replacement, revision, canonical rename,
  fresh-set duplication, and deletion to the logical page coherently;
- keeps alternate delivery endpoints out of creator lists and public
  exploration.

The remaining PDF capability exposes these contracts through strict bounded HTTP
upload and browser-native site viewing with direct preview/download fallbacks.

The PDF content core is implemented and registered with `PageService`; strict
binary HTTP upload is not. Its generic prerequisites include the endpoint
planner plus immutable-asset and atomic page/endpoint capability contracts, a
process-local reference, and shared persistence conformance. Core integration
coverage proves detached immutable bytes, bounded inspection, one-row queries,
coherent replacement/access/deletion, and identical inline/attachment delivery
over a generic configured endpoint set. Generic application commands now accept
complete intent for create and revision-bound replacement, preserve alternates
through canonical rename, and require a fresh complete set for endpoint-aware
duplication. Owner/public summaries expose complete safe endpoint links without
duplicating rows, and direct delivery selects disposition from the resolved
binding profile. Generic raw-binary content, PDF.js, text extraction,
thumbnails, and external storage are outside its first slice.

## CP-VIEW — Site-mediated viewing

The app can show an eligible public page inside a thin wrapper that provides:

- a preview or suitable fallback for the content type;
- a link to direct content;
- a link to the creator's default page when one exists;
- a link to the creator's other public pages.

The capability is implemented through HTTP-independent `PublicPageViewer` and
`PublicPageLister` interfaces. Public summaries omit management identity,
revision, and owner data; creator listings are bounded, cursor-paginated, and
exclude private and guest pages in both memory and Deno KV. `/site/<locator>`
projects that model with a sandboxed content frame or a direct-content fallback.
A private, invalid, or missing wrapped view is the same non-disclosing 404.

## CP-NAMESPACE — Authentication and namespace management

Account entry and namespace authority are separate capabilities. The implemented
Google-first authentication foundation can establish an application user,
upgrade a guest session, and end an authenticated session by rotating to a fresh
guest. Provider-account recovery remains with Google; no namespace is reserved
merely because a user is authenticated.

The subsequent namespace-ownership capability must let an authenticated creator:

- reserve an available unique namespace with concurrency-safe uniqueness;
- see the namespaces attached to the account;
- keep guests and other creators from mutating pages in reserved namespaces;
- reserve additional namespaces later.

Namespace reservation, memory or Deno KV persistence, authenticated listing and
claiming, and publishing authorization are implemented. Additional namespaces
already fit the repository model; release and transfer remain later.

## CP-MANAGE — Authenticated page management

Within a reserved namespace, a creator can:

- create a named page or configure a default page;
- list and inspect all managed pages, including private ones;
- update content and metadata;
- make a page public or private;
- rename a page without conflicting with another protected page;
- delete a page;
- duplicate a page under a generated available name;
- tag pages and filter them by available metadata;
- apply deletion or access changes to selected pages with a result for each
  page.

Programmatic management should follow the same namespace checks and page
behavior as the site.

The HTTP-independent management core now implements trial publishing and managed
create, bounded list, source inspection, revision-bound content/access update,
deletion, and owner-only private delivery. Process-local composition runs this
behavior through focused immutable-asset/page-aggregate capabilities; the
raw-Deno-KV adapter retains the compatible `PageRepository` path until its
replacement. Both paths preserve the current JSON behavior. Fresh collection,
item, action, and bulk routes now expose the strict bounded management adapter
with synchronizer CSRF, owner-safe presenters, pagination, and strong revision
ETags. The composed catch-all route uses the same service and session-derived
actor for public or owner-private delivery, while deployment storage selection
targets `PageRepository`. The site renders a creator management panel over these
same contracts: a server presenter lists the first page of managed rows, and the
island continues through `/api/pages` for pagination, inspection, editor-based
content updates, access toggling, and deletion, always revision-bound via the
published strong ETags. The DS-MANAGE core now adds explicit
`ManagedPageRenamer` and `ManagedPageDuplicator` contracts plus bounded tag
mutation and filtering. Rename is revision-bound, keeps stable identity and
metadata, atomically moves locator and owner indexes, and reports a managed
destination conflict; duplicate copies one exact source revision, including
tags, under a bounded generated available name and fresh ID. Managed
create/update normalize at most ten tags into a lowercase sorted unique set,
while list supports AND-combined page-name substring, exact access, and exact
tag filters. Public exploration accepts the same exact tag without disclosing
private or guest pages. Memory and Deno KV pass common mutation/filter/cursor
conformance, and old durable records without tags read as untagged.
`ManagedPageBulkAccessChanger` and `ManagedPageBulkDeleter` now accept a
prevalidated bounded set of distinct page/revision pairs and return one ordered,
independently revision-bound, non-disclosing result per page. Partial item
failure does not undo successful items, while invalid selections fail before any
mutation. Strict HTTP routes expose tags and managed filters, revision-bound
rename/duplicate actions, and bulk access/delete with session authentication,
synchronizer CSRF, and exact source revisions. The web-independent management
projection now carries locator and canonical tag data, validates API rows and
ordered bulk outcomes, and prepares every filter/action/bulk request. The
creator island exposes filter-bound continuation, content/tag editing, rename,
duplicate, explicit selection of at most 100 visible current revisions, and bulk
access/delete with one visible result per selected page. Stale individual or
bulk revisions refresh their affected rows instead of retrying silently.

## CP-EXPLORE — Public exploration

The first exploration version can browse all eligible pages or search by
case-insensitive namespace and page-name substrings, independently or together,
and can require one exact canonical tag. All supplied fields use AND semantics;
default pages match only when the page-name query is absent. Results are ordered
deterministically and cursor-paginated. They open the site-mediated view, which
links onward to direct content, the creator's default page when it exists, and
other public pages.

The capability is implemented through the HTTP-independent `PublicPageExplorer`
interface over `PageService`. Memory and Deno KV repositories satisfy the same
cross-namespace exploration conformance tests, and opaque continuations are
bound to both normalized query values and the optional exact tag. Visitor
summaries expose no page ID, revision, access field, or owner identity.
Eligibility is read from current page state, so private pages and guest trials
never enter browsing or search and a public-to-private change disappears
immediately. The site projects the model as a bounded GET search form and result
list, including one exact tag field and canonical tags on matching rows.

Text-content extraction, indexing, relevance, and view-count sorting remain
later work and can be added without changing page URLs or the visitor-facing
contract.

## CP-EXTERNAL — External content storage

Later, an authenticated creator can connect a storage provider and select
content for a page. Provider credentials must remain private, and provider
failure or disconnection must not accidentally serve another item. The app must
make clear whether it copies, serves, or redirects to provider content.
