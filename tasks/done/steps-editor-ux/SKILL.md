---
name: steps-editor-ux
description: Improve Steps previews, line composition, and CSS editing. Load when reviewing CSS-reactive line previews, independent list modifiers, empty Text lines, or CSS syntax highlighting.
created: 2026-07-17
updated: 2026-07-17
tags: [frontend, md-page, ux]
relates: [md-page-block-editor, improve-recent-state-ux]
---

Completed. Steps line previews now render through the client preview interface
in lazy sandboxed frames and update with editable CSS. Text, Heading, Link, and
raw Markdown are independent from bulleted/numbered list membership; empty Text
is the blank-line representation.

The editable CSS source has an aligned Prism overlay loaded from pinned,
integrity-checked jsDelivr assets, with plain-text fallback. All 88 tests,
check, production build, scripted Chromium interactions, and desktop/mobile
visual inspection pass. See [[003.summary]] and [[004.log]].
