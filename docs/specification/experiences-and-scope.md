# Experiences and scope

## EX-DIRECT — Open known content

A visitor can open a valid default or named locator directly. Eligible content
is returned with intentional status, media type, length, cache, isolation, and
disposition headers and without the site's navigation shell.

An invalid, absent, private, or unauthorized locator returns a real,
non-disclosing missing response. Platform routes are never consumed as page
locators.

## EX-WRAPPED — View through the site

`/site/<locator>` presents an eligible page inside a thin platform wrapper. It
provides content-type-appropriate preview or fallback, direct endpoint links,
the creator's public default page when present, and a bounded list of other
public pages in that namespace.

Creator HTML is confined to a sandboxed, no-referrer frame and never enters the
platform DOM. PDF uses the browser's native inline viewer with explicit preview,
download, Back, and unsupported-browser fallback links. Trial pages can be
wrapped by known locator but never expose creator listings.

## EX-EXPLORE — Find public creator pages

The site browses public managed pages and applies optional case-insensitive
namespace/page-name substrings plus one exact canonical tag with AND semantics.
Results are deterministic, bounded, and continued by an opaque cursor tied to
the complete query.

Private and trial pages are excluded by the page capability and repository, not
by components. A public-to-private change disappears from the next query.
Full-text content search and relevance ranking remain outside current scope.

## EX-PUBLISH — Publish content

The site and API accept the same locator, content, access, and endpoint intent
through shared application services. Success returns direct links; failures are
bounded and typed.

A guest can create or replace only a public untagged trial in an unreserved
namespace. An authenticated creator must own the namespace and send the current
session CSRF token.

Markdown uses strict JSON. PDF uses exactly one bounded JSON metadata part and
one bounded PDF file part. PDF endpoint intent includes a canonical inline
binding and at least one attachment alternate. The publisher chooses every
locator.

## EX-MANAGE — Manage creator pages

A signed-in creator can reserve namespaces and then:

- create default or named Markdown/PDF pages;
- list and filter owned pages;
- inspect bounded editable source or metadata;
- replace content, access, tags, or a complete endpoint set;
- rename within the namespace;
- duplicate into fresh endpoints;
- delete one page;
- bulk-change access or delete explicit selections.

Every mutation uses server-derived identity, namespace authority, CSRF, and an
exact page revision. Stale UI operations refresh affected rows but never retry a
mutation silently.

## EX-PDF — Share one PDF several ways

One PDF page can bind the same exact asset to configured inline and attachment
locators. Management and exploration still show one page. Access changes apply
to every endpoint, replacement changes all endpoint responses coherently, and
deletion removes every locator.
