# Page API

The API and site use the same HTTP-independent page service. All API responses
use `Cache-Control: no-store`. JSON errors have this shape:

```json
{ "ok": false, "error": "stable_code", "detail": "bounded safe detail" }
```

Two credentials authenticate this API — see
[the API authentication reference](authentication.md) for the complete
resolution rules and permission matrix; owner/user IDs are never accepted from
clients:

- **Browser session.** Authenticated mutations require the exact session
  synchronizer token in `x-csrf-token`. Guest browser sessions keep trial
  publication on `POST /api/pages` only.
- **API key** (see [the API-key contract](api-keys.md)) via
  `Authorization: Bearer <key>`. When the header is present it is authoritative:
  a malformed, unknown, expired, or revoked bearer receives one non-disclosing
  `401` with a `WWW-Authenticate: Bearer` challenge and never falls back to the
  cookie. Key requests carry no CSRF token; instead each operation requires the
  mapped permission, otherwise `403` `insufficient_permission`:
  - `read` — page list and inspect, namespace list;
  - `write` — page create, update, external re-link, rename, duplicate, bulk
    access change, and namespace reservation;
  - `delete` — page delete and bulk delete.

  A key-authenticated create is always a managed owner create, never trial
  publication. Namespace ownership, revision preconditions, and every other
  domain rule apply after the permission check exactly as for browser owners.

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
  "management_url": "/api/pages/opaque-id",
  "external_missing": {
    "cause": "external_content_missing",
    "detected_at": "2026-07-22T12:00:00.000Z"
  }
}
```

`locator` and `path` identify the structurally canonical endpoint: the preferred
reference used for management, exploration, and sorting, not content identity or
an implied profile. `endpoints` is the complete non-empty locator-reference set
in deterministic order. References may cross namespaces; managed creation and
mutation require the actor to own every namespace. Paths are
application-relative values formatted by the locator boundary. Tags are
lowercase sorted unique values; trial pages have none. `external_missing` is
owner-only and omitted for healthy pages. Its causes are
`external_content_missing`, `connection_revoked`, and `integrity_mismatch`.

List output omits editable content. Inspection adds handler-approved input:
Markdown source/CSS or bounded PDF filename, media type, size, version, and
replaceability. An external inspection instead identifies its safe provider and
opaque object reference under `content.external_source`; connection identity,
credentials, and payload bytes are never returned.

## Create — `POST /api/pages`

### Markdown JSON

```json
{
  "endpoint_set": {
    "canonical": {
      "locator": { "namespace": "Alice", "page_name": "notes" },
      "delivery_profile": "inline"
    },
    "alternates": [
      {
        "locator": { "namespace": "Notes", "page_name": "alice" },
        "delivery_profile": "inline"
      }
    ]
  },
  "access": "private",
  "tags": ["notes", "work"],
  "content": {
    "content_type": "md-page",
    "input": { "md": "# Notes", "css": "body { color: navy; }" },
    "storage": { "provider_id": "google-drive" }
  }
}
```

`endpoint_set` always has one canonical/preferred binding and optional
`alternates`; therefore every content creation has at least one explicit valid
locator and delivery profile. `page_name`, `alternates`, and `tags` are
optional. The legacy `locator` field remains accepted instead of `endpoint_set`
and means one `inline` canonical binding, but new callers should use the
explicit shape. A guest may create or replace only a public, untagged trial when
every referenced namespace is unreserved. An authenticated request always
attempts managed creation, requires CSRF, and must own every referenced
namespace; it never falls back to trial publication.

`content.storage` is optional and available only to managed creators. It selects
the caller's active connection for that provider; clients never supply a
connection ID. The provider must be currently composed with `write` capability.
Validation and derivation happen first, then the canonical bytes are uploaded,
and only a successful upload can commit the payload-free external asset and
page. Omission keeps inline custody. A requested external write never silently
falls back inline.

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
  "tags": ["reports"],
  "storage": { "provider_id": "google-drive" }
}
```

The complete set follows the same rules as Markdown: one or more unique valid
locators, each with a PDF-supported `inline` or `attachment` profile. The shown
pair is optional; a single attachment or inline locator is valid. References may
cross namespaces subject to authority. No suffix is generated or interpreted.
Declared file type/extension does not replace PDF validation. Authority, status,
location, ETag, and conflict behavior match Markdown create.

Typical failures: `400` malformed shape, `401` stale creator intent, `403` CSRF
or forbidden authority, `409` ownership/page/endpoint conflict, `413` oversized,
`415` unsupported media, `422` invalid locator/access/tag/content/endpoint,
`507` selected-storage endpoint capacity, and `503` identity generation
exhaustion.

## List — `GET /api/pages`

Requires authentication. Optional query fields:

- `namespace`: exact owned preferred-locator namespace;
- `name`: case-insensitive preferred page-name substring, at most 100
  characters;
- `access`: `public` or `private`;
- `tag`: exact canonical tag;
- `external_missing`: strict `true` or `false` health selection;
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
managed representation. JSON PATCH accepts `access`, `tags`, `content`,
`endpoint_set`, or a combination; omitted fields remain unchanged and an empty
tag array clears tags. `endpoint_set` is always a complete replacement, while a
content-only update preserves every locator reference and revalidates its
profiles against the replacement format.

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
includes a new file. Metadata may include the complete `endpoint_set`, `access`,
and `tags`; each omitted field is preserved. Metadata may also include the same
optional `storage` provider selector used by create. Markdown replacement puts
that selector inside `content`. Content and optional endpoint changes commit
once at the supplied revision.

Success returns the complete inspection and next ETag. Missing preconditions
return `428`, malformed validators `400`, a stale/different-page validator
`412`, missing/foreign pages `404`, conflicts `409`, invalid input `422`, and a
selected-storage endpoint-capacity failure `507`. Replacing content inline
creates a new immutable asset and clears any `external_missing` warning;
selecting external storage uploads and commits a fresh external asset instead.
Connection absence/revocation and providers without write capability return
`409`; transient or unavailable provider writes return `503`.

## Re-link external content — `POST /api/pages/:page_id/relink`

Requires owner authentication with `write`, CSRF for browser sessions, and an
exact `If-Match`. The strict body supplies a provider-native object reference:

```json
{ "external_ref": "1AbCdEf..." }
```

The service keeps the page's existing owner-proven provider connection, stats
and fetches the candidate within the current asset's byte bound, and requires a
byte-identical SHA-256 match. Success creates a new immutable external asset,
advances the page revision, and clears `external_missing`; it never mutates the
old asset. Missing candidates and byte mismatches return `422`, revoked
connections `409`, transient provider failures `503`, and stale intent `412`.
Changed content must use the ordinary validated inline replacement flow rather
than re-linking arbitrary provider bytes.

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
the inspection, and ETag. Rename changes only the preferred locator's page name;
additional references, identity, content, access, tags, and creation time stay
stable. Another managed destination returns `409`; invalid names `422`; stale
source `412`.

## Duplicate — `POST /api/pages/:page_id/duplicate`

Requires owner session, CSRF, and exact `If-Match`. A bodyless request keeps the
convenience behavior for a one-inline-endpoint page: the service chooses a
bounded available name. Any source can instead provide a fresh complete
destination set:

```json
{
  "endpoint_set": {
    "canonical": {
      "locator": { "namespace": "Alice", "page_name": "copy" },
      "delivery_profile": "inline"
    },
    "alternates": []
  }
}
```

Both forms copy the exact source revision to a fresh page ID at revision 1 while
sharing immutable content safely. Success returns `201`, `outcome`, inspection,
ETag, and management `Location`. Stale/missing sources, destination authority,
selected-storage capacity, and bounded name/ID exhaustion are typed failures.

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

`/site/explore` accepts optional `namespace` and `page` substring fields over
the preferred locator, one exact `tag`, and opaque `cursor`. Legacy
query-bearing `/` and `/site` URLs redirect to that canonical page. Each logical
content item appears once even when references span namespaces. Public results
contain no page ID, revision, access field, or owner identity. Private and trial
pages are excluded by the page repository capability.

## Direct delivery

Every configured endpoint path is separate from management URLs. Public pages
and known trial locators are directly readable. A private page is readable only
by its creator's current session; everyone else receives the ordinary missing
response.

After authority checks, the stored endpoint profile selects delivery behavior.
The current HTTP transport implements `inline` and `attachment` and returns
`501` rather than guessing for a future profile it does not implement. PDF
responses use `application/pdf`, `nosniff`, `no-store`, exact length, one strong
ETag per page revision, and `Accept-Ranges: bytes`. They support a complete
`200`, matching `304`, one satisfiable `206`, and bodyless `416`; `If-Range`
mismatch falls back to the complete current response. Inline and attachment
endpoints return byte-identical content and validators.
