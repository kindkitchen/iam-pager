# Product definition

## PD-GOAL — Goal

`iam-pager` is a content-sharing service built around deterministic URLs. A
publisher associates supported content with one or more locators, each composed
of a namespace and optional page name. A visitor opening any such locator
receives the content directly rather than first entering the site.

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
main purpose. A guest can publish a public trial page only when every referenced
namespace is unreserved, and receives no reservation, discovery, durability, or
overwrite guarantee. Another guest may replace a locator, and a creator may
reserve a referenced namespace and take it over.

## PD-CREATOR — Creator control

Google sign-in establishes an application user. A creator can reserve unique
namespaces and control their default and named pages. Reservation prevents guest
or cross-user mutation. Managed pages support create, inspect, update, access,
tag, rename, duplicate, bulk access/delete, and deletion operations under exact
revision checks.

A creator may also issue scoped API keys for automation. A key acts only on its
owner's behalf within explicit `read`/`write`/`delete` grants over the page and
namespace APIs; issuing, editing, and revoking keys remains a browser-session
capability.

## PD-PAGE — One logical page

A logical page has one content, management, and exploration identity independent
of its locators. Creation provides at least one valid locator reference, and any
number of additional valid references may point to the same current immutable
asset. One reference is preferred only so management and exploration have a
stable link.

Every reference has an explicit delivery profile supported by the content
format. Neither preferred status, a filename, nor a path suffix decides whether
content is shown inline, downloaded, or handled by a later delivery capability.
PDF demonstrates the model but has no special reference-count rule: one PDF may
have one locator or several inline and/or attachment locators without becoming
several managed pages.

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
