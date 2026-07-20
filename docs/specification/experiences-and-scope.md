# Experiences and scope

## EX-DIRECT — Visitor opens a known page

A visitor can open a namespace URL or a namespace-and-page URL directly. If a
public page exists, the response contains the current content with the correct
content type and download or display behavior.

The direct response does not include the site's navigation or management UI. A
missing or invalid page produces a clear not-found response that may link back
to the site; it does not silently return the home page as if the content had
been found.

A private page is not disclosed to a visitor who only knows its URL and behaves
as the missing page described above.

## EX-VIEW — Visitor uses the site view

A public page can also be opened inside a thin site wrapper. From there a
visitor can:

- view or preview the content when the format permits it;
- open the direct content response;
- open the creator's default public page;
- browse the creator's other public pages.

Creator content remains visually and technically distinguishable from the
platform's own controls: `/site/<locator>` labels and confines supported HTML in
a sandboxed, no-referrer frame, while the wrapper alone owns navigation and
related-page links. Unsupported content receives a metadata fallback and its
direct-content link. Trial pages remain viewable by known locator but expose no
creator listing; private and missing pages receive the same real 404.

## EX-EXPLORE — Explorer finds public pages

The site exposes a bounded browse list of public creator-backed pages. Its form
narrows by a case-insensitive namespace substring, a page-name substring, one
exact canonical tag, or an AND-combination. Results preserve the creator's
locator casing and open the thin site view, from which direct content, the
creator's default page when present, and other public pages remain available.
Opaque continuation keeps the active search fields attached to the next result
page.

Private pages and guest trials are excluded by the page capability and both
storage implementations, not by the web component. A current public-to-private
change removes a page from subsequent browse and search results immediately.
Guest pages remain reachable only by known direct or site-view locators.

The site form exposes tag filtering and matching rows show canonical tags.
Text-content extraction and indexing remain later scope.

## EX-PUBLISH — Publisher creates a page

A publishing flow accepts a namespace, an optional page name, supported content,
and the required delivery metadata. It returns the resulting direct URL and a
clear success or failure outcome. The same page behavior should be available
through the site and a programmatic API.

Even a guest may publish, but with stricter amount, size, frequency, retention,
and namespace limitations. A guest does not reserve the namespace, so content
there may be replaced by another guest or by an authenticated creator using the
same namespace. Guest pages do not enter site search or browsing; sharing the
direct URL is the only way to reach them.

## EX-PDF — Publisher creates and shares a PDF page

The implemented PDF HTTP flow accepts one strictly bounded multipart PDF file
and creates one logical page. The secondary site publishing form now exposes a
Markdown/PDF choice, bounded filename/size feedback, explicit canonical and
alternate locator/profile controls, and typed failures that keep the draft and
selected file intact. Creator management now shows profile-derived preview and
download links, bounded PDF metadata, and exact-revision replacement without a
silent stale retry; the wrapped public preview remains planned. A configured
direct endpoint can return `application/pdf` for browser-native inline viewing.
Another configured endpoint can return the same content asset with attachment
disposition and a safe filename. The publisher chooses both locators; a `.pdf`
suffix is only an ordinary possible name. The site wrapper may embed the native
preview, but always exposes explicit preview and download links and a fallback
when the browser cannot display PDF inline.

The creator manages one page rather than two copies. Access changes apply to
both endpoints, renaming moves the complete endpoint set or fails without a
partial move, content replacement changes what both endpoints deliver, and
deletion removes both from resolution. Public exploration lists only the
canonical page.

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
an authenticated page. The HTTP-independent core provides individual create,
list, inspect, content/access/tag update, delete, revision-bound same-namespace
rename, and generated-name duplicate operations. Tags are normalized into a
bounded canonical set; managed lists can AND-combine page-name substring,
access, and tag filters, and duplicate copies the selected source revision
including tags to a fresh ID. Bounded raw bulk commands accept 1-100 distinct,
explicit page/revision selections for one access target or deletion, then return
an ordered success, stale, or non-disclosing missing result for each item;
accepted items are independent rather than transactionally all-or-nothing.
Memory and Deno KV enforce each mutation atomically. The API exposes
create/update tags, managed filters, rename, duplicate, and both bulk commands
through the same strict session/CSRF/revision boundary as earlier management.
The site management panel projects those contracts with filter-bound
continuation, content/tag editing, same-namespace rename, generated duplication,
and an explicit selection of at most 100 visible current revisions for bulk
access or deletion. It shows one outcome per selected page and refreshes
revision conflicts without silently overwriting concurrent work.

## EX-EXTERNAL — Creator connects external storage later

A later version can let an authenticated creator connect a provider such as a
GitHub repository or Google Drive and associate provider content with a page.
The page URL should continue to behave like an `iam-pager` page even though the
content is stored elsewhere.
