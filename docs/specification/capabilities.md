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

## CP-NAMESPACE — Authentication and namespace management

An authenticated creator can:

- establish and end a session;
- reserve an available unique namespace;
- see the namespaces attached to the account;
- keep guests and other creators from mutating pages in reserved namespaces;
- reserve additional namespaces later.

Account recovery can follow the first protected publishing flow.

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

## CP-EXPLORE — Public exploration

The app can browse or search public pages by:

- page name;
- author namespace;
- tags;
- textual content when the format can be represented and indexed as text.

Results can lead to the site-mediated page, direct content, the creator's
default page, and other public pages. Private content is excluded.

Names and tags are enough for an initial search implementation; content search
can be added without changing page URLs.

## CP-EXTERNAL — External content storage

Later, an authenticated creator can connect a storage provider and select
content for a page. Provider credentials must remain private, and provider
failure or disconnection must not accidentally serve another item. The app must
make clear whether it copies, serves, or redirects to provider content.
