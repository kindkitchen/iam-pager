# Experiences and scope

## EX-DIRECT — Open known content

A visitor can open a valid default or named locator directly. Eligible content
is returned with intentional status, media type, length, cache, isolation, and
disposition headers and without the site's navigation shell.

An invalid, absent, private, or unauthorized locator returns a real,
non-disclosing missing response. Platform routes are never consumed as page
locators. An otherwise eligible page whose external payload is missing or
unreachable instead returns the bounded, platform-owned `503` placeholder from
`ES-DELIVERY`; provider details remain hidden.

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

The dedicated `/site/explore` navigation destination browses public managed
pages and applies optional case-insensitive namespace/page-name substrings plus
one exact canonical tag with AND semantics. Results are deterministic, bounded,
and continued by an opaque cursor tied to the complete query. Query-bearing
legacy home URLs redirect without discarding their search.

Private and trial pages are excluded by the page capability and repository, not
by components. A public-to-private change disappears from the next query.
Full-text content search and relevance ranking remain outside current scope.

## EX-PUBLISH — Publish content

The site and API accept the same locator, content, access, and endpoint intent
through shared application services. Success returns direct links; failures are
bounded and typed.

A guest can create or replace only a public untagged trial when every referenced
namespace is unreserved. An authenticated creator must own every referenced
namespace and send the current session CSRF token. Guest assets remain inline. A
creator may choose an active write-capable storage connection during publish or
content replacement; validation and upload must both succeed before the page can
reference the new external asset, with no silent inline fallback.

Markdown uses strict JSON. PDF uses exactly one bounded JSON metadata part and
one bounded PDF file part. Every format uses the same non-empty endpoint intent:
each publisher-chosen locator has an explicit profile supported by that format.
PDF may therefore be created with one inline or attachment reference, or with
several references in any supported combination. The web requires one primary
path and permits removable aliases for every format. Creator namespace fields
select from owned reservations; guest namespace entry remains free-form. A PDF
path's `Downloadable` control maps explicitly to attachment rather than deriving
behavior from an alias or suffix.

## EX-MANAGE — Manage creator pages

A signed-in creator can reserve namespaces and then:

- create default or named Markdown/PDF pages;
- list and filter owned pages;
- inspect bounded editable source or metadata;
- replace content, access, tags, or a complete endpoint set through
  owned-namespace path controls;
- rename within the namespace;
- duplicate into fresh endpoints;
- identify externally unavailable pages, re-link byte-identical provider copies,
  or replace inline to detach;
- delete one page;
- bulk-change access or delete explicit selections;
- connect or disconnect one account per provider, choose eligible storage during
  publish/replace, inspect bounded owner-safe connection status, and repair
  pages with unavailable external content.

Every mutation uses server-derived identity, namespace authority, CSRF, and an
exact page revision. Stale UI operations refresh affected rows but never retry a
mutation silently.

## EX-AUTOMATE — Automate with API keys

A signed-in creator can manage API keys at `/site/api-keys`: generate a key with
explicit permissions and optional expiry, copy the bearer exactly once, edit or
revoke individual keys, and revoke everything after explicit confirmation. The
page is one projection of the `/api/api-keys` capability; removing it removes no
key behavior.

A key authenticates the page and namespace APIs under its granted
`read`/`write`/`delete` permissions without CSRF. It never authenticates the
site, browser authentication routes, or direct-content delivery, and a
key-authenticated create is always managed — trial publication stays a guest
browser capability.

## EX-PDF — Share one PDF several ways

One PDF page can bind the same exact asset to one or more configured inline and
attachment locators. Management and exploration still show one page. Access
changes apply to every endpoint, content-only replacement preserves the locator
set and changes all endpoint responses coherently, and deletion removes every
locator.
