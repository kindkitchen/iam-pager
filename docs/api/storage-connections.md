# Storage connections API

Storage connections are browser-owned creator resources. They never establish
identity or namespace authority, and API keys never authenticate this surface.
All responses use `Cache-Control: no-store`; connection responses contain only
owner-safe metadata and never access tokens, refresh tokens, or encrypted
credential records.

## List — `GET /api/storage-connections`

Requires an authenticated browser session. Success:

```json
{
  "ok": true,
  "connections": [
    {
      "connection_id": "opaque-id",
      "provider_id": "google-drive",
      "provider_label": "Google Drive",
      "provider_subject": "creator@example.com",
      "scopes": ["https://www.googleapis.com/auth/drive.file"],
      "status": "active",
      "capabilities": ["read", "write"],
      "created_at": "2026-07-22T12:00:00.000Z",
      "updated_at": "2026-07-22T12:00:00.000Z"
    }
  ]
}
```

Capabilities describe the currently composed provider adapter. A retained
revoked connection or a provider unavailable in this deployment may have an
empty capability list.

## Connect — `POST /api/storage-connections/:provider_id`

Requires an authenticated browser session, exact `x-csrf-token`, and an empty
body. For `google-drive`, success returns `303` to the existing
`/auth/storage/google-drive/start` consent flow. OAuth state, callback binding,
and credential persistence remain owned by that flow. Unsupported providers
return `404`.

## Disconnect — `DELETE /api/storage-connections/:provider_id`

Requires an authenticated browser session, exact `x-csrf-token`, and an empty
body. For `google-drive`, the server attempts provider revocation and then
revokes the local active connection and destroys credentials. Success returns
`200 { "ok": true }`.

Disconnect is not blocked by dependent assets. Existing external pages keep
their immutable source references and become unavailable until repaired or
replaced. Missing active connections and unsupported providers return `404`.

An explicit `Authorization` header is rejected with `401` and never falls back
to the browser cookie.
