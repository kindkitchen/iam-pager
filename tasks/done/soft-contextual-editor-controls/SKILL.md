---
name: soft-contextual-editor-controls
description: Soften and contextualize the guest editor controls while adding durable content-sized Markdown sections, switchable source panes, adaptable preview layouts, and fullscreen preview. Load when reviewing guest form hierarchy, Page editor layout, section density, or preview controls.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, ux, markdown]
relates: []
---

Done and ready for review. Locator and Steps input actions form quiet integrated
fields. The collapsible Page workspace keeps exclusive Markdown/CSS source and
split/full-width layout choices, and its preview supports fullscreen with state
announcements. Guided cards measure whole CSS-reactive content by default;
per-card Compact/Whole choices survive saves/focus and follow structural
changes.

Validation: `deno task check`, 102 tests, production build, desktop/mobile
Chromium screenshots, and browser interaction checks for workspace restoration,
fullscreen, content sizing, focused forms, and compact-after-save behavior.
Section measurement allows same-origin parent inspection without scripts; full
preview remains opaque and script-disabled. No blocking review findings.
