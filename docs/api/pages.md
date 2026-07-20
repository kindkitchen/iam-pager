# Page management API

> Implementation status: this contract is composed into Fresh collection, item,
> action, and bulk routes and backed by the selected page repository.
>
> PDF publication is planned but not part of this implemented contract yet. Its
> future extension will use a strict bounded binary upload boundary rather than
> base64 inside the JSON content command, and will return one logical page with
> user-configured inline and attachment endpoint links over the same asset. No
> filename suffix has special routing or delivery meaning.

All responses from this API use `Cache-Control: no-store`. JSON errors have the
shape `{ "ok": false, "error": "...", "detail": "..." }`. Authentication is the
existing browser session; external bearer/API credentials are not supported.
Authenticated mutations require the exact session synchronizer token in
`x-csrf-token`.

Request JSON objects are strict. Unknown fields, missing required fields, arrays
where objects are required, unsupported media types, malformed JSON, and bodies
over 96 KiB are rejected before application services run. Owner and session IDs
are never accepted or returned.

Managed page tags are optional arrays of at most ten strings. Input is trimmed
and lowercased, duplicates collapse, and output is a sorted unique set. Each tag
must be 1–32 ASCII characters, start and end with an alphanumeric character, and
contain only alphanumerics, `-`, or `_`. Trial pages do not accept tags. Every
page summary includes `tags`; trials always return an empty array.

## Create or replace — `POST /api/pages`

```json
{
  "locator": {
    "namespace": "Alice",
    "page_name": "notes/today"
  },
  "access": "private",
  "tags": ["notes", "work"],
  "content": {
    "content_type": "md-page",
    "input": {
      "md": "# Notes",
      "css": "body { color: navy; }"
    }
  }
}
```

`page_name` and `tags` are optional; all other shown fields are required. A
guest may create or replace only a public, untagged trial page in an unreserved
namespace. Trial creation returns `201`; trial replacement returns `200`;
`Location` is the direct path.

An authenticated session always attempts managed creation and must send
`x-csrf-token`. Its namespace must already be owned by that creator. Creation
can atomically replace a trial at the locator but conflicts with another managed
page. It returns `201`, a management `Location`, and an `ETag`. A request that
still sends a creator CSRF header after its session has become guest returns
`401`; it never falls back to trial publishing.

Success includes `outcome`, an owner-safe `page` summary, exact direct `path`
and absolute `url`. Managed success also includes `management_url`.

Relevant failures are `400` invalid shape/JSON, `401` stale creator intent,
`403` invalid CSRF/private trial/forbidden authority, `409` unreserved creator
namespace or existing managed page, `413` oversized, `415` non-JSON, `422`
invalid locator/access/tags/content, and `503` exhausted server ID generation.

## List — `GET /api/pages`

Requires an authenticated session. Optional query fields are:

- `namespace`: an owned namespace filter;
- `name`: a case-insensitive page-name substring, at most 100 characters;
- `access`: exact `public` or `private`;
- `tag`: one exact tag after canonical normalization;
- `limit`: canonical decimal `1`–`100`, default `50`;
- `cursor`: the opaque unpadded continuation returned by the previous page.

All supplied filters use AND semantics. A continuation is bound to their exact
normalized scope. Duplicate or unknown query fields and oversized queries are
rejected. An invalid name/access/tag filter returns `400`; a namespace not owned
by the caller returns the same `404` shape as a missing resource.

```json
{
  "ok": true,
  "pages": [
    {
      "page_id": "opaque-id",
      "locator": { "namespace": "Alice", "page_name": "notes/today" },
      "path": "/Alice/notes/today",
      "access": "private",
      "content_type": "md-page",
      "size_bytes": 1234,
      "tags": ["notes", "work"],
      "created_at": "2026-07-19T12:00:00.000Z",
      "updated_at": "2026-07-19T12:00:00.000Z",
      "revision": 1,
      "etag": "\"page-opaque-id-r1\"",
      "management_url": "/api/pages/opaque-id"
    }
  ],
  "next_cursor": null
}
```

List output contains neither editable source nor stored derivations. Each
managed summary includes the exact `etag` value accepted by `If-Match`.

## Inspect — `GET /api/pages/:page_id`

Requires the authenticated owner. Missing, trial, other-owner, and
no-longer-authorized IDs all return `404`. Success returns the summary plus safe
editable input and a strong validator:

```http
ETag: "page-opaque-id-r1"
```

```json
{
  "ok": true,
  "page": {
    "page_id": "opaque-id",
    "locator": { "namespace": "Alice", "page_name": "notes/today" },
    "path": "/Alice/notes/today",
    "access": "private",
    "content_type": "md-page",
    "size_bytes": 1234,
    "tags": ["notes", "work"],
    "created_at": "2026-07-19T12:00:00.000Z",
    "updated_at": "2026-07-19T12:00:00.000Z",
    "revision": 1,
    "etag": "\"page-opaque-id-r1\"",
    "management_url": "/api/pages/opaque-id",
    "content": {
      "content_type": "md-page",
      "input": { "md": "# Notes", "css": "body { color: navy; }" }
    }
  }
}
```

Derived HTML and storage fields are never returned.

## Update — `PATCH /api/pages/:page_id`

Requires the authenticated owner, exact `x-csrf-token`, and exactly one strong
`If-Match` value from inspect/create/update. The patch must contain `access`,
`tags`, `content`, or a combination; omitted fields remain unchanged. An empty
tag array clears all tags.

```json
{ "access": "public", "tags": ["published", "notes"] }
```

```json
{
  "content": {
    "content_type": "md-page",
    "input": { "md": "# Replacement" }
  }
}
```

Success returns `200`, the complete inspection representation, and the next
ETag. Missing `If-Match` returns `428`; malformed, weak, wildcard, multiple, or
non-canonical validators return `400`; a different-page or stale validator
returns `412`. Missing/non-owner pages return `404`, and invalid
content/access/tags return `422`.

## Delete — `DELETE /api/pages/:page_id`

Requires the same authenticated owner, CSRF, and `If-Match` preconditions as
PATCH and accepts no body. Success returns `204`. Stale validators return `412`;
a repeated delete and non-owner access return `404`.

## Rename — `POST /api/pages/:page_id/rename`

Requires the authenticated owner, `x-csrf-token`, one exact source `If-Match`,
and a strict JSON body. Supply `page_name` to move within the current namespace;
omit it with `{}` to make the page that namespace's default page.

```json
{ "page_name": "archive/notes" }
```

Success returns `200`, `outcome` (`renamed`, `replaced_trial`, or `unchanged`),
the complete inspection representation, and its current `ETag`. Page identity,
content, access, tags, and creation time are retained. Another managed page at
the destination returns `409 page_exists`; invalid names return `422`; stale
source revisions return `412`. Missing and non-owner sources return the same
`404`.

## Duplicate — `POST /api/pages/:page_id/duplicate`

Requires the authenticated owner, `x-csrf-token`, and one exact source
`If-Match`. The request is bodyless. The server chooses a bounded generated
available name in the source namespace and copies the exact source snapshot
without changing it.

Success returns `201`, `outcome` (`created` or `replaced_trial`), the new
complete inspection representation at revision 1, its `ETag`, and a management
`Location`. Stale source revisions return `412`; missing and non-owner sources
return `404`; bounded name or ID generation exhaustion returns `503`.

## Bulk access — `POST /api/pages/bulk/access`

Requires the authenticated owner and `x-csrf-token`. Because each selected page
has its own source revision, this command does not use one HTTP `If-Match`.
Instead, its strict body contains an exact target access and 1–100 distinct
page/revision pairs:

```json
{
  "access": "public",
  "selection": [
    { "page_id": "page-a", "expected_revision": 3 },
    { "page_id": "page-b", "expected_revision": 7 }
  ]
}
```

The complete shape, access value, IDs, positive safe revisions, distinctness,
and count are validated before mutation. An accepted command returns `200` and
one result in selection order. Items then apply independently:

```json
{
  "ok": true,
  "results": [
    {
      "page_id": "page-a",
      "ok": true,
      "page": {
        "page_id": "page-a",
        "locator": { "namespace": "Alice", "page_name": "notes" },
        "path": "/Alice/notes",
        "access": "public",
        "content_type": "md-page",
        "size_bytes": 1234,
        "tags": ["notes"],
        "created_at": "2026-07-19T12:00:00.000Z",
        "updated_at": "2026-07-19T12:05:00.000Z",
        "revision": 4,
        "etag": "\"page-page-a-r4\"",
        "management_url": "/api/pages/page-a"
      }
    },
    {
      "page_id": "page-b",
      "ok": false,
      "error": "revision_conflict"
    }
  ]
}
```

Item errors are `revision_conflict`, `revision_exhausted`, or non-disclosing
`not_found`. One item failure does not roll back another. Invalid access or a
selection rejected as a whole returns `422` and performs no mutation.

## Bulk delete — `POST /api/pages/bulk/delete`

Uses the same authentication, CSRF, selection shape, prevalidation, ordered
execution, and independent revision discipline as bulk access:

```json
{
  "selection": [
    { "page_id": "page-a", "expected_revision": 4 },
    { "page_id": "page-b", "expected_revision": 7 }
  ]
}
```

An accepted command returns `200` even when an individual item fails:

```json
{
  "ok": true,
  "results": [
    { "page_id": "page-a", "ok": true },
    { "page_id": "page-b", "ok": false, "error": "not_found" }
  ]
}
```

Item errors are `revision_conflict` or non-disclosing `not_found`. An invalid
selection returns `422` before mutation.

## Creator site projection

The authenticated creator panel is a secondary projection of these contracts,
not a separate management implementation. Its initial server model and every API
row carry locator, canonical tags, revision, and exact ETag. Name, access, and
exact-tag filters remain attached to continuation requests. Content and a
comma-separated tag draft save through one revision-bound PATCH; empty tags
clear the set. Rename sends an omitted `page_name` for the default page, while
duplicate remains bodyless.

Bulk controls select at most 100 currently visible rows and derive the explicit
`page_id`/`expected_revision` pairs at submission time. The panel validates the
ordered response before changing state and shows one outcome per item.
Successful rows update or leave the active filter, missing rows disappear, and
revision conflicts are inspected again; the browser never retries a stale
mutation.

## Public tag exploration

Public exploration remains a site GET surface rather than a management JSON
endpoint. `/` and `/site` accept optional `namespace` and `page` substring
fields plus one exact `tag`; all supplied fields use AND semantics. The opaque
`cursor` retains the complete filter scope. Only public managed pages are
eligible, and the rendered rows expose their canonical tags without page IDs,
revisions, access fields, or owner identity.

## Direct delivery

The management URL is separate from the direct locator path. Public trial and
managed pages are directly readable. A private managed page is directly readable
only by its stored creator's current session; guest, logged-out creator, and
another user receive the ordinary missing-page response. The catch-all Fresh
route derives the actor from the resolved session and uses the same composed
page service as management.
