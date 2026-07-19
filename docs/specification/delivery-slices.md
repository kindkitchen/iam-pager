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

The API-first core of this slice is composed: Fresh exposes collection and item
management routes over the selected page repository, and direct delivery uses
the same page service with session-derived authority. The site now also projects
that boundary as a creator management panel - bounded listing with continuation,
inspection, content editing, revision-bound access changes, and confirmed
deletion - without adding management rules to the web layer. The expanded
operations of DS-MANAGE remain later work.

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
continued by an opaque cursor bound to both query fields; each opens the DS-VIEW
wrapper and its direct/default/other-page links.

`PublicPageExplorer` keeps this behavior outside Fresh. Memory and Deno KV scan
their current locator state behind the same repository contract and conformance
suite, excluding private and guest pages before any result is returned. Tags
join when DS-MANAGE supplies them. Text-content search, indexing, relevance, and
view-count sorting remain later work.

## DS-MANAGE — Expand authenticated management

The creator can filter managed pages, rename without conflicts, duplicate with a
generated name, apply selected bulk changes, and reserve additional namespaces.

Date and view filters are added only when the corresponding metadata is useful
and trustworthy.

## DS-EXTERNAL — Evaluate external storage

After first-party publishing is stable, one external provider can test whether a
page should copy, serve, synchronize, or redirect to provider content. The
evaluation must preserve the locator behavior and namespace protection already
visible to users.
