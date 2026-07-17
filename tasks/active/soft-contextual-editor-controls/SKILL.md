---
name: soft-contextual-editor-controls
description: Soften and contextualize the guest editor controls while adding durable content-sized Markdown sections, switchable source panes, adaptable preview layouts, and fullscreen preview. Load when changing guest form hierarchy, Page editor layout, section density, or preview controls.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, ux, markdown]
relates: []
---

Active implementation. Replace prominent standalone form labels and helpers with quiet controls attached to their parent fields. Rework Page editing so Markdown and CSS are mutually exclusive source panes, the editor can collapse without losing state, layout switches between side-by-side preview and full-width source with preview below, and preview can enter fullscreen.

Markdown section previews must show their content-sized whole view by default and offer a persistent per-section compact toggle. Density state must survive source edits and focus changes. Finish with responsive/accessibility review, documentation, and full validation before moving to review-ready `done`.
