---
name: soft-contextual-editor-controls
description: Soften and contextualize the guest editor controls while adding durable content-sized Markdown sections, switchable source panes, adaptable preview layouts, and fullscreen preview. Load when changing guest form hierarchy, Page editor layout, section density, or preview controls.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, ux, markdown]
relates: []
---

Active implementation. Deterministic workspace and Markdown section-density controllers now preserve source/layout choices across collapse and carry whole/compact preferences through section reconciliation, movement, and removal; six focused tests pass.

Next: wire the controllers into softer contextual locator and Page controls, add fullscreen preview, then measure whole section previews and expose persistent compact toggles. Finish with responsive/accessibility review, documentation, and full validation before moving to review-ready `done`.
