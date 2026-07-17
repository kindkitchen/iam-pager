---
name: section-based-steps-editor
description: Evolve Steps from physical-line controls to section editing. Load when reviewing nested list controls, fenced code-block sections, or grip-driven section ordering.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, md-page, ux]
relates: [steps-editor-ux, md-page-block-editor]
---

Completed. Steps is now backed by a lossless `MarkdownSectionEditor`: fenced
backtick/tilde blocks are one multiline section, while focused one-line forms
and unknown raw Markdown retain conservative behavior. Changed code blocks
receive a safe non-conflicting fence.

List styling uses `Is list item` with a nested unchecked-by-default `Numbered`
checkbox. Sections append through one plus control and reorder as whole units
via a prefixed grip, pointer/touch drop targets, or focused-grip keyboard
commands. Visible directional/contextual move buttons are gone.

All 92 tests, check, production build, scripted mouse/touch/keyboard
interactions, and mobile visual inspection pass. See [[005.summary]] and
[[006.log]].
