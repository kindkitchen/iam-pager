# Product definition

## PD-IDEA — Idea

`iam-pager` is a content-sharing site built around deterministic URLs. A person
associates content with a namespace and, optionally, a page name. A visitor who
opens that URL receives the content directly rather than first entering the
site.

The platform does not decide what a group of pages means or how they relate.
That is left to the author. A page may contain HTML, text, an image, a PDF, or
another supported format, and it may be displayed or downloaded as appropriate
for that format.

The app has two connected directions:

- sharing and exploring content;
- managing content through an authenticated, profile-oriented site.

## PD-CORE — Core experience

A publisher chooses a namespace and optional page name, provides supported
content, and receives a direct URL. A visitor can open that URL without going
through the site UI. The site remains available for wrapped viewing, public
exploration, and management.

An authenticated creator can reserve a unique namespace and manage its default
and named pages. Reservation protects those pages from other creators and gives
the owner a stable place for create, update, rename, duplicate, access, and
delete operations.

Even an unauthenticated guest may publish content. Guest publishing uses the
same basic content and locator idea but has stricter limits and no namespace
reservation. Content at a guest locator may be replaced by another guest or by
an authenticated creator using the same namespace.

## PD-VISITORS — Visitors and exploration

A visitor can:

- open a known public page URL and receive its content directly;
- inspect a public page inside a thin site wrapper;
- continue to the raw content, the creator's default page, or the creator's
  other public pages;
- explore public pages by page name, author namespace, tags, and text content
  when that content can reasonably be indexed as text.

Private authenticated pages are available only to their creator's authorized
session.

## PD-MVP — Initial boundary

The first coherent app proves that supported content can be published and
retrieved predictably through namespace-based URLs. It includes direct delivery,
a basic publishing surface, clear public or private behavior, and enough site UI
to inspect and manage pages.

Guest publishing is a limited variation of the publishing flow, not the purpose
of the product. Public exploration supports namespace and page-name browsing and
search plus exact-tag filtering; text extraction remains later. Advanced
management is API-accessible after basic create, update, and delete behavior,
and the creator site now projects its filters, tags, rename, duplicate, and
explicit per-page-result bulk controls.

External storage providers are later scope. They are valuable because page
formats and sizes vary, but first-party content must establish the page and
locator behavior first.
