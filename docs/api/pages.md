# Page management API

> Implementation status: this contract is composed into the Fresh collection and
> item routes and backed by the selected page repository.

All responses from this API use `Cache-Control: no-store`. JSON errors have the
shape `{ "ok": false, "error": "...", "detail": "..." }`. Authentication is the
existing browser session; external bearer/API credentials are not supported.
Authenticated mutations require the exact session synchronizer token in
`x-csrf-token`.

Request JSON objects are strict. Unknown fields, missing required fields, arrays
where objects are required, unsupported media types, malformed JSON, and bodies
over 96 KiB are rejected before application services run. Owner and session IDs
are never accepted or returned.

## Create or replace — `POST /api/pages`

```json
{
  "locator": {
    "namespace": "Alice",
    "page_name": "notes/today"
  },
  "access": "private",
  "content": {
    "content_type": "md-page",
    "input": {
      "md": "# Notes",
      "css": "body { color: navy; }"
    }
  }
}
```

`page_name` is optional; all other shown fields are required. A guest may create
or replace only a public trial page in an unreserved namespace. Trial creation
returns `201`; trial replacement returns `200`; `Location` is the direct path.

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
invalid locator/access/content, and `503` exhausted server ID generation.

## List — `GET /api/pages`

Requires an authenticated session. Optional query fields are:

- `namespace`: an owned namespace filter;
- `limit`: canonical decimal `1`–`100`, default `50`;
- `cursor`: the opaque unpadded continuation returned by the previous page.

Duplicate or unknown query fields and oversized queries are rejected. A filter
not owned by the caller returns the same `404` shape as a missing resource.

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
`content`, or both; omitted fields remain unchanged.

```json
{ "access": "public" }
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
returns `412`. Missing/non-owner pages return `404`, and invalid content/access
returns `422`.

## Delete — `DELETE /api/pages/:page_id`

Requires the same authenticated owner, CSRF, and `If-Match` preconditions as
PATCH and accepts no body. Success returns `204`. Stale validators return `412`;
a repeated delete and non-owner access return `404`.

## Expanded management operations

Rename and generated-name duplication are implemented in the HTTP-independent
page service and both repositories, but are deliberately not yet exposed by
these routes. Their future HTTP shapes must retain authenticated ownership,
synchronizer CSRF, strong source-revision preconditions, strict request
decoding, and the existing non-disclosing error boundary. Tags, managed filters,
and bulk operations remain unimplemented.

## Direct delivery

The management URL is separate from the direct locator path. Public trial and
managed pages are directly readable. A private managed page is directly readable
only by its stored creator's current session; guest, logged-out creator, and
another user receive the ordinary missing-page response. The catch-all Fresh
route derives the actor from the resolved session and uses the same composed
page service as management.
