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

## DS-VIEW — Present a page through the site

A visitor can open a public page in a thin site wrapper, continue to its direct
content, visit the creator's default page, and see other public pages. Supported
content is previewed without confusing it with the platform UI; other content
has a suitable download or fallback view.

## DS-EXPLORE — Explore public pages

Exploration begins with page names, namespaces, and tags. Text-content search
can join this slice or follow it when supported extraction is ready. Private
pages never enter results.

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
