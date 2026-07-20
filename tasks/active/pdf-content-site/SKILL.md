---
name: pdf-content-site
description: Add the secondary site experience for publishing, managing, previewing, and downloading PDF pages. Load when working on PDF file controls, browser-native wrapped previews, fallbacks, or PDF management projection.
created: 2026-07-20
updated: 2026-07-21
tags: [frontend, pdf, publishing, management]
relates: [pdf-content-http, pdf-content-core, kv-toolbox-content-persistence]
---

Active, chain position 5 of 5. Durable v2 persistence and the bounded PDF HTTP
contract are complete and consumed as contracts only.

Done:
- Step 1 boundary — `lib/ui/page-content-type.ts` maps a Markdown/PDF choice and
  editable PDF intent onto the accepted multipart create contract, verified
  against the real decoder. See [[008.log]].
- Navigation foundation (incremental) — `lib/ui/site-breadcrumb.ts` is a
  raw-code location model + presenter rendered by `SiteBreadcrumb`, wired into
  home, the public view, and a prototype `/site/manage` split. See
  [[007.analysis]] and [[009.log]].
- Site PDF publication — a raw bounded file-selection presenter and accessible
  picker now feed the multipart boundary from the existing publish island with
  explicit ordinary endpoint/profile controls and preserved API-error draft
  state. See [[010.log]].
- Typed failures and creator PDF management — one raw failure presenter maps
  endpoint/PDF/size/authority/stale/availability outcomes without unknown detail;
  creator rows derive preview/download links from returned profiles, inspect only
  bounded metadata, and replace through one exact-revision multipart request
  while retaining the selected file on failure. See [[011.log]].

Next: add the public browser-native PDF wrapper with explicit preview/download
fallbacks, then verify exploration one-row/type/size behavior and responsive
browser acceptance. Must not import kv-toolbox, inspect storage keys, or own
persistence/HTTP behavior. PDF.js and generic binary UI remain later. See
[[012.summary]].
