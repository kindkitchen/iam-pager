# API authentication

Every `/api/**` request resolves to exactly one principal before any operation
runs:

- **guest browser** — a request without an `Authorization` header whose cookie
  resolves to a guest session;
- **browser user** — a request without an `Authorization` header whose cookie
  resolves to an authenticated session;
- **API key** — a request whose `Authorization: Bearer <key>` header resolves to
  an active key (see [the API-key contract](api-keys.md)).

Owner and user IDs are never accepted from clients; identity always comes from
the resolved principal.

## Credential precedence

A present `Authorization` header is authoritative:

- The cookie is ignored entirely. A request carrying any `Authorization` header
  never resolves, renews, or creates a browser session, and no session cookie is
  issued for it.
- Only the exact `Bearer <token>` scheme is accepted. A malformed scheme, an
  empty token, an unknown key, an expired key, and a revoked key all produce one
  non-disclosing `401` with `WWW-Authenticate: Bearer realm="api"` and the
  stable error code `invalid_bearer`. There is no fallback to the cookie.

Without an `Authorization` header, the ordinary cookie session decides between
guest and browser user. Bearers ride only in the `Authorization` header on
`/api/**`: query strings, bodies, cookies, `/auth/**`, site routes, and
direct-content routes never carry a key.

## CSRF policy

- **Browser user** mutations require the exact session synchronizer token —
  `x-csrf-token` header on page and API-key operations, the `csrf_token` body
  field on namespace reservation. Reads need no token.
- **API key** requests carry no CSRF token in any position. Each operation
  instead requires the mapped permission below; a valid key without it receives
  `403` `insufficient_permission`.
- **Guest browser** requests can perform only trial publication; everything else
  fails with `401` `not_authenticated`.

Domain rules are unchanged by the credential: namespace ownership, exact
revision `If-Match` preconditions, request bounds, and non-disclosing `404`
responses apply after the principal and permission checks for browser and key
callers alike.

## Permission matrix

Key permissions are explicit `read`, `write`, and `delete` grants (`all` expands
at creation time; see [the API-key contract](api-keys.md)).

| Operation                           | Guest browser | Browser user          | API key             |
| ----------------------------------- | ------------- | --------------------- | ------------------- |
| `GET /api/pages`                    | never         | yes                   | `read`              |
| `POST /api/pages`                   | trial only    | yes + CSRF            | `write` (managed)   |
| `GET /api/pages/:id`                | never         | yes                   | `read`              |
| `PATCH /api/pages/:id`              | never         | yes + CSRF + If-Match | `write` + If-Match  |
| `POST /api/pages/:id/relink`        | never         | yes + CSRF + If-Match | `write` + If-Match  |
| `DELETE /api/pages/:id`             | never         | yes + CSRF + If-Match | `delete` + If-Match |
| `POST /api/pages/:id/rename`        | never         | yes + CSRF + If-Match | `write` + If-Match  |
| `POST /api/pages/:id/duplicate`     | never         | yes + CSRF + If-Match | `write` + If-Match  |
| `POST /api/pages/bulk/access`       | never         | yes + CSRF            | `write`             |
| `POST /api/pages/bulk/delete`       | never         | yes + CSRF            | `delete`            |
| `GET /api/namespaces`               | never         | yes                   | `read`              |
| `POST /api/namespaces`              | never         | yes + body CSRF       | `write`             |
| `GET /api/api-keys`                 | never         | yes                   | never               |
| `POST /api/api-keys`                | never         | yes + CSRF            | never               |
| `GET /api/api-keys/:id`             | never         | yes                   | never               |
| `PATCH /api/api-keys/:id`           | never         | yes + CSRF + If-Match | never               |
| `DELETE /api/api-keys/:id`          | never         | yes + CSRF + If-Match | never               |
| `DELETE /api/api-keys` (revoke-all) | never         | yes + CSRF            | `delete`            |

Notes:

- A key-authenticated `POST /api/pages` is always a managed owner create; trial
  publication exists only for a guest browser session.
- Key management stays browser-owned. An explicit bearer on any key-management
  operation other than revoke-all is rejected with the non-disclosing `401`
  regardless of its grants. Bearer revoke-all revokes the calling key too.
- Keys never authenticate site routes, `/auth/**`, or direct-content delivery,
  including private direct content.

## Errors

| Status | Code                      | Meaning                                      |
| ------ | ------------------------- | -------------------------------------------- |
| `401`  | `invalid_bearer`          | Explicit bearer failed; no cookie fallback   |
| `401`  | `not_authenticated`       | Cookie principal lacks the required session  |
| `403`  | `invalid_csrf`            | Browser mutation without the exact token     |
| `403`  | `insufficient_permission` | Valid key without the operation's permission |

All API responses use `Cache-Control: no-store` and the shared error shape
`{ "ok": false, "error": "stable_code", "detail": "bounded safe detail" }`.
