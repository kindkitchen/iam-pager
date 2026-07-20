---
name: pdf-content-http
description: Expose bounded PDF publication, replacement, inline preview, and attachment delivery through strict HTTP adapters. Load when working on PDF upload transport, endpoint links, disposition headers, ranges, CSRF, or ETags.
created: 2026-07-20
updated: 2026-07-20
tags: [api, http, pdf, security]
relates: [pdf-content-core, kv-toolbox-content-persistence, pdf-content-site]
---

Todo, unblocked, chain position 4 of 5. PDF core and readiness-gated durable v2
persistence are complete.

Next: choose and document the bounded binary transport and byte-range policy,
then accept the publisher's explicit endpoint locator/profile set without
base64, generated paths, or HTTP logic entering the content core. kv-toolbox
blob/response helpers must not become the HTTP contract: range, disposition,
ETag, and response mapping stay in web-independent HTTP adapter code, never
Fresh routes or components. See [[001.draft]], [[002.decision]], and
[[004.log]].
