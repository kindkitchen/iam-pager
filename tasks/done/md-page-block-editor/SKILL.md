---
name: md-page-block-editor
description: Add a mobile-first structured Markdown editor to MdPage while preserving raw Markdown as the single source of truth. Load when working on line-based Markdown editing, insertion controls, or PageEditor UX.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, md-page, ux]
relates: []
---

Completed. MdPage now has a mobile-first Raw/Steps editor backed solely by the
raw Markdown string, with lossless physical-line operations, value-preserving
type changes, guarded mutations, content-only previews, and Paste/Copy/Clear
controls. Paste includes a manual fallback for blocked clipboard reads. All
checks, 86 tests, production build, mobile inspection, and direct/fallback
clipboard checks pass.
