---
name: improve-recent-state-ux
description: Improve the current guest publishing UX without changing publishing, locator, or storage behavior. Load when reviewing the mobile-first page editor, random locator helpers, CSS presets, or live preview.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, ux, not-important]
relates: [content-publishing]
---

Importance: explicitly **not important**. Completed as a UI-only refinement with
publishing logic unchanged.

Delivered four-word random locator helpers, the mobile-first Page editor with
All/Preview/CSS views, editable replace-all CSS presets, and a sandboxed live
preview backed by `MdPageHandler`.

Review passed all checks. Known gaps: collision fallback is local because guest
publishing has no availability query, and exact browser preview adds a large
client chunk. See [[005.summary]] and [[004.review]].
