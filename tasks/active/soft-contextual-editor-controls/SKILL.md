---
name: soft-contextual-editor-controls
description: Soften and contextualize the guest editor controls while adding durable content-sized Markdown sections, switchable source panes, adaptable preview layouts, and fullscreen preview. Load when changing guest form hierarchy, Page editor layout, section density, or preview controls.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, ux, markdown]
relates: []
---

Active implementation. Locator labels and Random actions now form quiet
integrated fields. The Page workspace collapses with state intact, shows one
Markdown/CSS source pane, switches between responsive split and
full-width/preview-below layouts, and supports browser fullscreen preview.
Deterministic workspace and section-density controllers have six focused tests;
type checks and production build pass.

Next: measure whole Markdown section previews, expose persistent compact
toggles, and contextualize their field-level optional actions. Finish with
responsive/accessibility review, full validation, and review before moving to
`done`.
