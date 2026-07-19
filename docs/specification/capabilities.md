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
  platform routes.

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
deletion, and owner-only private delivery over the `PageRepository` interface.
Its memory and Deno KV adapters are complete and pass the same repository
conformance. Fresh collection and item routes now expose the strict bounded
create/list/inspect/update/delete adapter with synchronizer CSRF, owner-safe
presenters, pagination, and strong revision ETags. The composed catch-all route
uses the same service and session-derived actor for public or owner-private
delivery, while deployment storage selection targets `PageRepository`. The site
renders a creator management panel over these same contracts: a server presenter
lists the first page of managed rows, and the island continues through
`/api/pages` for pagination, inspection, editor-based content updates, access
toggling, and deletion, always revision-bound via the published strong ETags.
The first DS-MANAGE core now adds explicit `ManagedPageRenamer` and
`ManagedPageDuplicator` contracts. Rename is revision-bound, keeps the stable
page ID/content/access/creation time, atomically moves locator and owner
indexes, and reports a managed destination conflict; duplicate copies one exact
source revision under a bounded generated available name and fresh ID. A
destination trial may be retired consistently with managed creation. Memory and
Deno KV pass the same conformance and concurrent claims settle on one winner.
HTTP endpoints and creator controls for these operations are still pending;
tags, managed filters, and bulk actions remain later DS-MANAGE work.

## CP-EXPLORE — Public exploration

The first exploration version can browse all eligible pages or search by
case-insensitive namespace and page-name substrings, independently or together.
When both fields are present a result must match both; default pages have no
page name and therefore match only browsing or a namespace query. Results are
ordered deterministically and cursor-paginated. They open the site-mediated
view, which links onward to direct content, the creator's default page when it
exists, and other public pages.

The capability is implemented through the HTTP-independent `PublicPageExplorer`
interface over `PageService`. Memory and Deno KV repositories satisfy the same
cross-namespace exploration conformance tests, and opaque continuations are
bound to both normalized query values. Visitor summaries expose no page ID,
revision, access field, or owner identity. Eligibility is read from current page
state, so private pages and guest trials never enter browsing or search and a
public-to-private change disappears immediately. The site projects the model as
a bounded GET search form and result list.

Tags join after page management supplies them. Text-content extraction,
indexing, relevance, and view-count sorting remain later work and can be added
without changing page URLs or the visitor-facing contract.

## CP-EXTERNAL — External content storage

Later, an authenticated creator can connect a storage provider and select
content for a page. Provider credentials must remain private, and provider
failure or disconnection must not accidentally serve another item. The app must
make clear whether it copies, serves, or redirects to provider content.
