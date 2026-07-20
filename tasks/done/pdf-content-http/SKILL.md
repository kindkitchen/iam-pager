---
name: pdf-content-http
description: Expose bounded PDF publication, replacement, inline preview, and attachment delivery through strict HTTP adapters. Load when working on PDF upload transport, endpoint links, disposition headers, ranges, CSRF, or ETags.
created: 2026-07-20
updated: 2026-07-20
tags: [api, http, pdf, security]
relates: [pdf-content-core, kv-toolbox-content-persistence, pdf-content-site]
---

Done, chain position 4 of 5. Strict bounded PDF HTTP create, exact-revision
replacement, inline preview, attachment delivery, opaque validators, and single
byte ranges are implemented without base64 or generated paths.

The web-independent adapter owns exact multipart framing/parts/limits, endpoint
metadata, ranges, disposition, ETags, and response mapping; Fresh routes remain
thin. JSON Markdown is compatible, private delivery stays session-derived and
non-disclosing, and memory plus readiness-gated durable v2 support the complete
endpoint set. See [[006.decision]] and [[007.summary]]. Next:
`pdf-content-site` can implement the secondary browser experience.
