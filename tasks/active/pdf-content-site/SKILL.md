---
name: pdf-content-site
description: Add the secondary site experience for publishing, managing, previewing, and downloading PDF pages. Load when working on PDF file controls, browser-native wrapped previews, fallbacks, or PDF management projection.
created: 2026-07-20
updated: 2026-07-20
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

Next: bounded PDF file-selection UI feeding the step-1 boundary, then creator
PDF metadata/preview/replace/download, then the public native-preview wrapper
with download and fallback. Must not import kv-toolbox, inspect storage keys, or
own persistence/HTTP behavior. PDF.js and generic binary UI remain later. See
[[001.draft]] and [[002.decision]].
