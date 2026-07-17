---
name: soft-contextual-editor-controls
description: Soften and contextualize the guest editor controls while adding durable content-sized Markdown sections, switchable source panes, adaptable preview layouts, and fullscreen preview. Load when reviewing guest form hierarchy, Page editor layout, section density, or preview controls.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, ux, markdown]
relates: []
---

Done and ready for review. `ExclusiveContentSwitcher` renders Markdown/CSS and
Raw/Steps as accessible tabs attached to the panel edge they replace, with
selected/control/panel semantics and Arrow/Home/End navigation. Split/full-width
remains detached and labelled as layout; section type remains a draft-shape
picker. Existing softer fields, persistent workspace/layout, fullscreen preview,
and whole/compact section behavior remain intact.

Validation: `deno task check`, 102 tests, production build,
desktop/mobile/Raw/Steps/CSS visual checks, and browser interaction checks for
controlled panels, hidden inactive content, preserved mode, and keyboard
focus/selection. No blocking findings.
