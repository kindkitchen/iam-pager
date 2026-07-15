# Experiences and scope

## EX-DIRECT — Visitor opens a known page

A visitor can open a namespace URL or a namespace-and-page URL directly. If a
public page exists, the response contains the current content with the correct
content type and download or display behavior.

The direct response does not include the site's navigation or management UI. A
missing or invalid page produces a clear not-found response that may link back
to the site; it does not silently return the home page as if the content had
been found.

A private page is not disclosed to a visitor who only knows its URL and behave
as missing page described above.

## EX-VIEW — Visitor uses the site view

A public page can also be opened inside a thin site wrapper. From there a
visitor can:

- view or preview the content when the format permits it;
- open the direct content response;
- open the creator's default public page;
- browse the creator's other public pages.

Creator content must remain visually and technically distinguishable from the
platform's own controls.

## EX-EXPLORE — Explorer finds public pages

The site can expose public pages through search and browsing. Search is intended
to cover:

- page names and author namespaces, together or separately;
- tags;
- content matches when supported content can be represented and indexed as text.

Search must not expose private pages.

## EX-PUBLISH — Publisher creates a page

A publishing flow accepts a namespace, an optional page name, supported content,
and the required delivery metadata. It returns the resulting direct URL and a
clear success or failure outcome. The same page behavior should be available
through the site and a programmatic API.

Even a guest may publish, but with stricter amount, size, frequency, retention,
and namespace limitations. A guest does not reserve the namespace, so content
there may be replaced by another guest or by an authenticated creator using the
same namespace.

## EX-MANAGE — Authenticated creator manages pages

A creator authenticates and selects an available unique namespace. Reserving it
prevents guests and other creators from replacing pages in that namespace. Guest
content already using the namespace does not prevent reservation.

Within a reserved namespace, the creator can:

- create, inspect, change, and delete a page;
- change content and page name;
- choose public or private access;
- configure a default page for the namespace;
- duplicate a page with a generated non-conflicting name;
- search and filter managed pages by name, dates, views, and tags where those
  fields are available;
- select pages for bulk deletion or access changes;

A name conflict within the reserved namespace is reported instead of replacing
an authenticated page.

## EX-EXTERNAL — Creator connects external storage later

A later version can let an authenticated creator connect a provider such as a
GitHub repository or Google Drive and associate provider content with a page.
The page URL should continue to behave like an `iam-pager` page even though the
content is stored elsewhere.
