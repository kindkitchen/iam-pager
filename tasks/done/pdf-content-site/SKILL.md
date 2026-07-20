---
name: pdf-content-site
description: Completed the secondary site experience for publishing, managing, previewing, and downloading PDF pages. Load when reviewing the PDF site projection, browser-native wrapper, fallbacks, or management controls.
created: 2026-07-20
updated: 2026-07-21
tags: [frontend, pdf, publishing, management]
relates: [pdf-content-http, pdf-content-core, kv-toolbox-content-persistence]
---

Done, chain position 5 of 5. The secondary PDF site experience now covers raw
multipart publication intent, bounded file feedback, typed failures, creator
metadata/replacement controls, logical navigation, one-row exploration, and a
public browser-native wrapper.

The wrapper derives its canonical inline preview and attachment downloads from
returned endpoint profiles, never serializes PDF bytes, and retains Back,
direct-open, download, and unsupported-browser fallback links. Responsive
mobile/desktop Chromium acceptance exercised a real composed publication; all
579 tests and the production build pass. See [[012.summary]] and [[013.log]].

PDF.js, generic binary UI, external storage, and persistence/HTTP ownership
remain explicitly outside this completed task.
