---
name: section-drag-merge
description: Improve guided Markdown section controls and add drag-to-merge behavior. Load when working on Steps list controls, section dragging, or value absorption.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, markdown]
relates: []
---

Completed. `Numbered` stays beside list membership. Dragging over a card center
merges it while card edges and the final target reorder. The destination keeps
its type and combines the source primary value directly: one-line fields use a
space, Code blocks use a physical newline, and no HTML break tags are generated.
The source card disappears; dirty affected edits remain protected. Merge
semantics live in `MarkdownSectionEditor`. Validation: 96 tests and repository
checks pass.
