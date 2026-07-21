# Page API

The API and site use the same HTTP-independent page service. All API responses
use `Cache-Control: no-store`. JSON errors have this shape:

```json
{ "ok": false, "error": "stable_code", "detail": "bounded safe detail" }
```

Authentication uses the browser session. There are no external API bearer
credentials. Authenticated mutations require the exact session synchronizer
token in `x-csrf-token`; owner/user IDs are never accepted from clients.

JSON objects and query strings are strict and bounded. Unknown fields, duplicate
query fields, malformed input, unsupported media, and oversized requests fail
before mutation. Ordinary JSON bodies are limited to 96 KiB.

## Page representations

Managed summaries contain:

```json
{
  "page_id": "opaque-id",
  "locator": { "namespace": "Alice", "page_name": "notes" },
  "path": "/Alice/notes",
  "endpoints": {
    "canonical": {
      "locator": { "namespace": "Alice", "page_name": "notes" },
      "path": "/Alice/notes",
      "delivery_profile": "inline"
    },
    "alternates": []
  },
  "access": "private",
  "content_type": "md-page",
  "size_bytes": 1234,
  "tags": ["notes"],
  "created_at": "2026-07-19T12:00:00.000Z",
  "updated_at": "2026-07-19T12:00:00.000Z",
  "revision": 1,
  "etag": "\"page-opaque-id-r1\"",
  "management_url": "/api/pages/opaque-id"
}
```

`locator` and `path` identify the canonical endpoint. `endpoints` is the
complete one-to-eight-binding set in deterministic order. Paths are
application-relative values formatted by the locator boundary. Tags are
lowercase sorted unique values; trial pages have none.

List output omits editable content. Inspection adds handler-approved input:
Markdown source/CSS or bounded PDF filename, media type, size, version, and
replaceability. PDF bytes and storage IDs are never returned.

## Create — `POST /api/pages`

### Markdown JSON

```json
{
  "locator": { "namespace": "Alice", "page_name": "notes" },
  "access": "private",
  "tags": ["notes", "work"],
  "content": {
    "content_type": "md-page",
    "input": { "md": "# Notes", "css": "body { color: navy; }" }
  }
}
```

`page_name` and `tags` are optional. A guest may create or replace only a
public, untagged trial in an unreserved namespace. An authenticated request
always attempts managed creation, requires CSRF, and must target an owned
namespace; it never falls back to trial publication.

Create returns `201`; trial replacement returns `200`. Success includes
`outcome`, page summary, direct `path`/absolute `url`, `Location`, and, for a
managed page, `ETag` plus `management_url`.

### PDF multipart

PDF create uses `multipart/form-data` with an unquoted boundary of at most 70
permitted characters. The stream-enforced body limit is 16 MiB plus 64 KiB and
contains exactly two file parts:

1. `metadata`, filename `metadata.json`, `application/json`, at most 16 KiB;
2. `file`, portable non-empty filename, `application/pdf`, at most 16 MiB.

Metadata is strict UTF-8 JSON:

```json
{
  "endpoint_set": {
    "canonical": {
      "locator": { "namespace": "Alice", "page_name": "report-preview" },
      "delivery_profile": "inline"
    },
    "alternates": [
      {
        "locator": { "namespace": "Alice", "page_name": "report-download" },
        "delivery_profile": "attachment"
      }
    ]
  },
  "access": "private",
  "tags": ["reports"]
}
```

The complete set has 2–8 unique same-namespace locators, a canonical inline
binding, and at least one attachment alternate. No suffix is generated or
interpreted. Declared file type/extension does not replace PDF validation.
Authority, status, location, ETag, and conflict behavior match Markdown create.

Typical failures: `400` malformed shape, `401` stale creator intent, `403` CSRF
or forbidden authority, `409` ownership/page/endpoint conflict, `413` oversized,
`415` unsupported media, `422` invalid locator/access/tag/content/endpoint, and
`503` identity generation exhaustion.

## List — `GET /api/pages`

Requires authentication. Optional query fields:

- `namespace`: exact owned namespace;
- `name`: case-insensitive page-name substring, at most 100 characters;
- `access`: `public` or `private`;
- `tag`: exact canonical tag;
- `limit`: canonical decimal `1`–`100`, default `50`;
- `cursor`: opaque continuation from the same normalized filter scope.

Filters use AND semantics. Success returns `pages` and `next_cursor`. A
namespace not owned by the caller has the same shape as a missing resource.

## Inspect — `GET /api/pages/:page_id`

Requires the authenticated owner. Missing, trial, foreign, and no-longer-
authorized IDs all return `404`. Success returns the complete inspection and a
strong page/revision `ETag`.

## Update — `PATCH /api/pages/:page_id`

Requires owner session, CSRF, and exactly one strong `If-Match` from a previous
managed representation. JSON PATCH accepts `access`, `tags`, `content`, or a
combination; omitted fields remain unchanged and an empty tag array clears tags.

```json
{ "access": "public", "tags": ["published"] }
```

```json
{
  "content": {
    "content_type": "md-page",
    "input": { "md": "# Replacement" }
  }
}
```

PDF replacement uses the same exact two-part multipart boundary and always
includes a new file. Metadata requires the complete `endpoint_set` and may
include `access` and `tags`; omitted metadata is preserved. Content and endpoint
changes commit once at the supplied revision.

Success returns the complete inspection and next ETag. Missing preconditions
return `428`, malformed validators `400`, a stale/different-page validator
`412`, missing/foreign pages `404`, conflicts `409`, and invalid input `422`.

## Delete — `DELETE /api/pages/:page_id`

Requires owner session, CSRF, exact `If-Match`, and no body. Success returns
`204` and removes every page endpoint. Stale intent returns `412`; repeated or
foreign deletion returns `404`.

## Rename — `POST /api/pages/:page_id/rename`

Requires owner session, CSRF, and exact `If-Match`. The strict JSON body
contains `page_name`; `{}` makes the page its namespace default.

```json
{ "page_name": "archive/notes" }
```

Success returns `200`, `outcome` (`renamed`, `replaced_trial`, or `unchanged`),
the inspection, and ETag. Identity, content, access, tags, and creation time
stay stable. Another managed destination returns `409`; invalid names `422`;
stale source `412`.

## Duplicate — `POST /api/pages/:page_id/duplicate`

Requires owner session, CSRF, exact `If-Match`, and no body. For a one-inline-
endpoint page, the service chooses a bounded available name and copies the exact
source revision to a fresh page ID at revision 1 while sharing immutable content
safely. Pages with richer endpoint sets require explicit destination endpoint
intent through the application capability and are not duplicated by this
bodyless HTTP command.

Success returns `201`, `outcome`, inspection, ETag, and management `Location`.
Stale/missing sources and bounded name/ID exhaustion are typed failures.

## Bulk commands

`POST /api/pages/bulk/access`:

```json
{
  "access": "public",
  "selection": [
    { "page_id": "page-a", "expected_revision": 3 },
    { "page_id": "page-b", "expected_revision": 7 }
  ]
}
```

`POST /api/pages/bulk/delete` uses the same `selection` without `access`.

Both require authentication and CSRF. The complete 1–100-item selection must
contain distinct valid page IDs and positive revisions before any mutation.
Accepted items execute independently in order and return one success,
`revision_conflict`, `revision_exhausted` (access only), or non-disclosing
`not_found` result. One item failure does not roll back another.

## Public exploration

`/` and `/site` accept optional `namespace` and `page` substring fields, one
exact `tag`, and opaque `cursor`. Public results contain no page ID, revision,
access field, or owner identity. Private and trial pages are excluded by the
page repository capability.

## Direct delivery

Every configured endpoint path is separate from management URLs. Public pages
and known trial locators are directly readable. A private page is readable only
by its creator's current session; everyone else receives the ordinary missing
response.

After authority checks, the stored endpoint profile selects `inline` or
`attachment`. PDF responses use `application/pdf`, `nosniff`, `no-store`, exact
length, one strong ETag per page revision, and `Accept-Ranges: bytes`. They
support a complete `200`, matching `304`, one satisfiable `206`, and bodyless
`416`; `If-Range` mismatch falls back to the complete current response. Inline
and attachment endpoints return byte-identical content and validators.
