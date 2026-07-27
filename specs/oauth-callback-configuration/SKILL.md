---
name: oauth-callback-configuration
description: How Google sign-in and Google Drive callback URLs are selected across original, local, and preview modes. Load when changing OAuth composition, redirect URIs, or preview deployment settings.
updated: 2026-07-23
sources: [fix-google-signin-redirect-after-logout, google-drive-preview-oauth]
---

## Sign-in (`IAM_PAGER_GOOGLE_AUTH_*`)

Original mode always uses the exact configured `IAM_PAGER_GOOGLE_AUTH_REDIRECT_URI`.
`IAM_PAGER_GOOGLE_AUTH_REQUEST_HOST_PATTERN` is parsed and used only in local
mock mode; the service resolver independently rejects request-derived callbacks
in original mode. Google requires every emitted `redirect_uri` to be registered
exactly, so a dynamic callback is unusable there.

Deployment requirement: set `IAM_PAGER_GOOGLE_AUTH_REDIRECT_URI` exactly as
registered under the matching sign-in client. Application code cannot repair a
wrong client/Cloud Console pair.

Logout revokes only the iam-pager bearer and creates a fresh guest session;
Google keeps its own login session, which is why a repeat sign-in may skip
account selection. That is not a bug and not redirect state mutation.

## Drive (`IAM_PAGER_GOOGLE_DRIVE_*`)

Local mode needs no redirect URI, client ID, or client secret. Callback and
mock-consent origins come from the HTTPS request only after a complete host
regex match; route paths stay application-controlled. Local mode is mock-only
and registers no remote Drive provider.

Local callback source precedence:

1. Drive-specific `IAM_PAGER_GOOGLE_DRIVE_REQUEST_HOST_PATTERN`;
2. a complete static Drive callback + mock-consent URL pair;
3. the already validated Google auth request-host pattern, inherited at
   composition.

Original Drive mode never inherits the auth pattern, and its credential errors
state that they apply when `IAM_PAGER_GOOGLE_DRIVE_MODE=original`. Partial stale
static configuration does not prevent dynamic preview composition.

Common preview profile therefore needs only the auth request-host pattern; the
Drive-specific pattern is an optional override. See `.env.example` and
`docs/deployment-environment.md` for the full variable list.
