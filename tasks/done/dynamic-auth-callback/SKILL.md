---
name: dynamic-auth-callback
description: Add allowlisted request-host Google callback URLs for dynamic local-mode preview deployments. Load when changing authentication callback URL selection, mock consent, or preview deployment configuration.
created: 2026-07-18
updated: 2026-07-18
tags: [authentication, deployment, security]
relates: []
---

Completed. Dynamic local preview mode requires only Google mode plus a narrow
HTTPS request-host pattern; callback and mock consent are request-derived and
same-origin. Static URL variables remain required only for ordinary local mode
without a pattern. Optional fallback URLs must be supplied together and stay on
one loopback origin. Untrusted hosts fail closed, and matched hosts deliberately
expose fake sign-in. Verification: check, 177 tests, and production build pass.
