---
name: improve-recent-state-ux
description: Improve the current guest publishing UX without changing publishing, locator, or storage behavior. Load when reviewing the mobile-first page editor, random locator helpers, CSS presets, or client-only live preview.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, ux, not-important]
relates: [content-publishing]
---

Importance: explicitly **not important**. Completed as a UI-only refinement with
publishing logic unchanged.

Delivered four-word random locator helpers, the mobile-first Page editor with
All/Preview/CSS views, editable replace-all CSS presets, and a fully client-side
sandboxed preview using browser-compatible `marked`. Publish-time validation and
sanitization remain owned by `MdPageHandler`.

Published links use same-tab navigation so Back returns to the editor; Markdown
starts with a concise usable draft. Final review passed 78 tests, production
build, client graph inspection, and Firefox. Remote locator availability remains
unsupported by the overwriteable guest flow. See [[015.summary]] and
[[014.review]].
