---
name: fix-google-signin-redirect-after-logout
description: Fix Google sign-in redirect URI mismatch exposed after logout. Load when working on repeated Google sign-in, callback URL selection, or OAuth deployment configuration.
created: 2026-07-24
updated: 2026-07-24
tags: [auth, hotfix]
relates: []
---

Completed: original Google mode always uses its exact configured callback and rejects request-derived callbacks; dynamic hosts remain local-preview-only. Repeated starts and the full sign-in/logout/sign-in lifecycle are covered, documentation is current, and verification/build pass.
Operational requirement: deploy with `IAM_PAGER_GOOGLE_AUTH_REDIRECT_URI` exactly registered under the matching Google sign-in client.
