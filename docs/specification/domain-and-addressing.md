# Domain and addressing

## DA-NAMESPACE — Namespace

A namespace is the creator-controlled scope of a page locator. An authenticated
creator can reserve a unique namespace, after which only that creator can manage
pages within it. An account may support additional reserved namespaces later.

Even a guest may use a namespace, but does not reserve it. Guest content may be
replaced by another guest or by an authenticated creator who uses the same
namespace. Guest publishing cannot replace content in an already reserved
namespace.

Namespace and page-name validation must be consistent during publishing and
lookup.

## DA-PAGE — Page

A page is one logical management and exploration identity with one current
content asset and the metadata needed to deliver and manage it. It has one
canonical locator and may have additional endpoint bindings for alternate
delivery behavior. Those bindings are representations of the same page, not
independent pages.

A page can be named or can be the namespace's default page. Its content can
change without requiring a new canonical locator. Managed pages have an opaque
stable management ID that is separate from locator and endpoint identity; it is
not part of a direct URL and remains stable across content, endpoint, or access
changes. For protected pages, changing the page name must not collide with
another page or any reserved endpoint binding in the same namespace.

A page is either a public, unowned trial or a managed page whose creator is
recorded only by server-owned storage. Managed pages may be public or private.
Their current representation has a positive revision, and
content/access/tag/endpoint changes or deletion must match that revision so
concurrent intent cannot be silently overwritten.

## DA-ENDPOINT — Page delivery endpoint

A delivery endpoint binds a locator to one logical page and one delivery
profile. The profile states behavior such as `inline` or `attachment`; direct
HTTP maps that stored behavior to headers. The publisher supplies each endpoint
locator as ordinary locator intent. A suffix such as `.pdf` carries no special
meaning and is neither generated nor interpreted by content or delivery logic.

One endpoint is canonical and a page may have at most seven alternates. The
canonical endpoint is explicitly designated and may use any profile supported by
the content type; it is not implicitly the inline endpoint. Alternate endpoints
do not receive their own page ID, revision, tags, access, management row, or
exploration row. Page authority and visibility are checked after endpoint
resolution against the one logical page.

Every binding belongs to the canonical locator's same case-insensitive namespace
and every locator is unique inside the set. Canonical and alternate locators may
each be default or named. Add, change, remove, canonical change, and display-
casing change submit the complete one-to-eight-binding set against the exact
page revision. Alternate input order is not semantic. Storage checks all old and
new claims and publishes the page, revision, and complete binding set or none.

## DA-CONTENT-ASSET — Stored content identity

A content asset is an immutable stored payload plus validated type-specific
metadata. A page points to its current asset; multiple endpoint bindings, and
later multiple page snapshots, may reference the same asset. Replacing content
creates or selects another asset and atomically changes the page reference, so
all endpoints expose one current payload. Physical byte duplication is an
adapter choice and is not required by product semantics.

An asset is not publicly resolvable without an eligible page endpoint. Removing
a page or replacing its asset may leave an unreferenced staged asset for bounded
cleanup, but must never expose incomplete content or delete bytes still
referenced elsewhere.

## DA-LOCATOR — Locator

A locator is composed of:

- a namespace;
- an optional page name, whose absence addresses the namespace's default page.

The locator model is independent of its public URL mapping. A deployment may map
the namespace to a path component, a subdomain, or another route shape without
changing publishing, lookup, search, or ownership behavior. The HTTP mapping
must still avoid conflicts with site assets, management routes, and API routes.

Namespace, page-name, and endpoint-locator uniqueness are case-insensitive.
Displayed and returned values preserve the publisher-supplied casing. Internal
representation is not specified. Alternate endpoint locators participate in
collision checks even though they remain absent from page search and management
lists.

A valid locator resolves to one current page response. Deterministic means that
resolution is predictable; it does not mean the content can never change.

## DA-CONTENT — Content

Content is the payload plus intrinsic metadata such as media type, size, and an
optional safe suggested filename. It may be textual or binary. Inline versus
attachment behavior belongs to the resolved endpoint rather than requiring a
second content copy or changing the content asset.

"Raw" or "direct" content means the response is not wrapped in the site. It
still uses normal HTTP behavior and any handling needed to stop creator content
from gaining access to authenticated management sessions.

The product should support varied formats and size bands over time. The MVP must
explicitly list the formats and limits it actually accepts rather than
pretending every file can be displayed safely. `md-page` is implemented. The
transport-independent `pdf` handler is also implemented with a 16 MiB bound,
fixed `application/pdf` media type, detached immutable bytes, bounded safe
filename metadata, and both inline and attachment profile support. Generic
application commands now accept user-configured complete endpoint intent for
creation, revision-bound replacement, and duplication; either profile may use
any valid, non-conflicting locator. The concrete PDF HTTP boundary now requires
a canonical inline binding and at least one attachment alternate, accepts the
binary through strict bounded multipart rather than JSON, and serves strict
single ranges. Generic raw-binary handling remains later.

## DA-ACCESS — Access

The original access model is intentionally simple:

- public content can be opened by visitors and can appear in exploration;
- private content can be opened only through its creator's authorized session.

Guest pages are publicly deliverable but never appear in exploration; a visitor
must know the direct URL to open one for raw preview.

Public does not imply that the platform created or endorses the content.

## DA-TAGS — Managed page tags

Tags are page metadata, not locator identity or creator content. Managed pages
may carry at most ten tags; trial pages carry none. Input is trimmed and
lowercased, duplicates collapse, and storage uses a sorted unique set. Each tag
is 1–32 ASCII characters, starts and ends with an alphanumeric character, and
uses only alphanumerics, `-`, or `_`. Tag replacement is revision-bound; rename
preserves tags and duplicate copies them from the exact source revision.

Managed listing uses exact tag matching alongside page-name substring and access
filters. Public exploration exposes tags only for eligible public managed pages
and can require one exact tag. Tags never make a private or trial page publicly
discoverable.

## DA-LIFECYCLE — Replacement, rename, and deletion

Protected namespaces reject replacement by another actor. Their creators control
content changes and deletion. A rename must reject conflicts and should tell the
creator that old shared URLs may stop working. When a page has alternate
endpoints, create and rename publish or move the complete endpoint set, access
changes cover every endpoint, content replacement switches their shared asset,
and deletion removes all endpoint visibility. Redirects and revision history are
optional later behavior, not required for the first version.

The implemented rename core is revision-bound and keeps the stable page ID while
atomically replacing its case-insensitive locator and owner-list position inside
the same namespace. Another managed page is a conflict; an older trial may be
retired as it is during managed creation. Duplication leaves the source
unchanged and creates revision 1 under a bounded server-generated available name
and fresh ID from the exact expected source revision. Strict HTTP actions and
the creator panel project both operations; the panel uses the displayed current
revision and refreshes a stale source instead of retrying it.

Duplication creates a fresh page and destination endpoint set but may safely
reference the same immutable content asset. A later replacement changes only the
mutated page's asset reference. The one-endpoint `md-page` compatibility command
continues to generate one available canonical name; endpoint-aware application
callers must supply a complete fresh destination set so aliases are never
silently dropped.

Authenticated storage should be durable enough for normal management use, but
the app should not promise that content can never disappear under any
circumstance. The practical retention and backup behavior should be stated when
those systems are implemented.

The first optional durable boundary covers ownership records: Deno KV stores
application users, provider identities, and namespace reservations together so a
persisted claim always retains a resolvable owner after restart. Sessions and
page content may separately opt into that same ownership database; durable
sessions or durable content with process-local ownership are rejected, so a
persisted page in a reserved namespace always retains its resolvable reservation
and owner. There is currently no application expiry or deletion for ownership
records and no automatic migration between memory, database paths, or backends.
Without the content opt-in, pages remain process-local.
