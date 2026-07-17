---
name: improve-recent-state-ux
description: Improve the current guest publishing UX without changing publishing, locator, or storage behavior. Load when reviewing the mobile-first page editor, random locator helpers, CSS presets, or server-owned live preview.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, ux, not-important]
relates: [content-publishing]
---

Importance: explicitly **not important**. Completed as a UI-only refinement with
publishing logic unchanged.

Delivered four-word random locator helpers, the mobile-first Page editor with
All/Preview/CSS views, editable replace-all CSS presets, and a sandboxed live
preview. The browser uses a Fetch-based `PagePreviewer`; `MdPageHandler` and its
Deno/server dependency graph stay behind the bounded internal preview endpoint.

Regression review passed 80 tests, production build, client graph inspection,
and Firefox. Remote locator availability remains unsupported by the
overwriteable guest flow. See [[010.summary]] and [[009.review]].
