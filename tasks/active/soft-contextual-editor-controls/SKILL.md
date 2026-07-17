---
name: soft-contextual-editor-controls
description: Soften and contextualize the guest editor controls while adding durable content-sized Markdown sections, switchable source panes, adaptable preview layouts, and fullscreen preview. Load when changing guest form hierarchy, Page editor layout, section density, or preview controls.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, ux, markdown]
relates: []
---

Active implementation. Locator and Steps input actions now form quiet integrated
fields. The Page workspace collapses with state intact, shows one Markdown/CSS
source pane, switches between responsive split and full-width/preview-below
layouts, and supports browser fullscreen preview. Guided cards measure whole
CSS-reactive content by default; persistent Compact/Whole choices survive
saves/focus and follow structural changes.

Six controller tests, 21 focused section tests, type checks, production build,
desktop/mobile Chromium smoke checks, and automated compact-after-save
verification pass. Next: run full validation and accessibility/security review,
resolve findings, then mark `done` for review.
