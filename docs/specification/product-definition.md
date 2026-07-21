# Product definition

## PD-GOAL — Goal

`iam-pager` is a content-sharing service built around deterministic URLs. A
publisher associates supported content with a namespace and optional page name.
A visitor opening that locator receives the content directly rather than first
entering the site.

The platform does not define what pages mean or how several pages relate. A page
may represent any author-chosen purpose within the supported content and safety
rules.

## PD-DIRECTIONS — Product directions

The product has two connected surfaces:

1. publish, resolve, share, and explore content through stable application and
   HTTP behavior;
2. manage namespaces and pages through an authenticated, profile-oriented site.

The site is one representation of the application. It must not become the source
of publishing, access, management, or exploration rules.

## PD-GUEST — Guest publishing

Guest publishing is a constrained form of normal publishing, not the product's
main purpose. A guest can publish a public trial page in an unreserved namespace
but receives no reservation, discovery, durability, or overwrite guarantee.
Another guest may replace that locator, and a creator may reserve the namespace
and take it over.

## PD-CREATOR — Creator control

Google sign-in establishes an application user. A creator can reserve unique
namespaces and control their default and named pages. Reservation prevents guest
or cross-user mutation. Managed pages support create, inspect, update, access,
tag, rename, duplicate, bulk access/delete, and deletion operations under exact
revision checks.

## PD-PAGE — One logical page

A logical page has one management and exploration identity even when one content
asset is available at several locators. Every endpoint has an explicit delivery
profile. Neither a filename nor a path suffix decides whether content is shown
inline or downloaded.

PDF demonstrates this model: the same uploaded bytes can back a browser-preview
endpoint and an attachment endpoint without creating two managed pages.

## PD-VISITOR — Visitor experience

Visitors can open known public content directly, inspect it through a thin site
wrapper, and browse public creator pages by namespace, page name, and tag.
Private pages are available only to their creator's authorized session. Trial
pages remain known-locator only.

## PD-SCOPE — Current boundary

The current product supports first-party Markdown and PDF publication, direct
delivery, namespace ownership, creator management, wrapped public views, and
bounded public exploration.

External storage, generic file hosting, full-text indexing, quotas, rate limits,
guest expiry, account deletion, and permanent-storage guarantees are not part of
the current boundary.
