---
name: agent-automation
description: The published agent skill document and the per-page block_api_write lock. Load when touching /site/skill, lib/agent-skill, markdown block rendering, or key-authenticated page mutations.
updated: 2026-07-29
sources: [agent-skill, api-write-lock]
---

Automation has two halves: a document that teaches an agent how to use this
platform, and a per-page lock that lets a creator take any page back from every
key. Both live in `lib/`; the web renders them.

## Code map

- `lib/agent-skill/skill.ts` — `AgentSkillDocument`, `AgentSkillSource`,
  `StaticAgentSkillSource`, and the document itself. The Markdown is the source
  of truth; nothing else authors skill text.
- `lib/ui/agent-skill.ts` — `AgentSkillPresenter` projecting one document into
  `{ markdown, blocks, usage, raw_href, file_name }`.
- `lib/ui/markdown-blocks.ts` — trusted-document block parser (front matter,
  headings, paragraphs, lists, tables, fenced code; inline code, bold, links).
- `components/MarkdownDocument.tsx` — renders blocks as real elements;
  `dangerouslySetInnerHTML` is forbidden by lint and unnecessary.
- `components/AgentSkillPage.tsx` + `islands/AgentSkillCopy.tsx` +
  `routes/site/skill/index.tsx` + `routes/site/skill/raw.ts`.
- Lock: `lib/page/aggregate.ts` (`block_api_write`, `is_api_write_blocked`),
  `lib/page/interfaces.ts` (`UserPageActor.via_api_key`, `api_write_blocked`,
  `protection_requires_session`), `lib/page/service.ts`, both aggregate
  repositories, `lib/page/http.ts`, `lib/ui/page-management.ts`,
  `islands/PageManagementPanel.tsx`.

## Rules in force

- The skill document is code. `/site/skill` renders it, `/site/skill/raw`
  serves it verbatim as `text/markdown`, and the copy control copies the exact
  text. A second front-end (CLI, MCP server, packaged skill file) consumes the
  same `AgentSkillSource` without the site.
- The skill instructs, it does not enforce: the platform issues no per-agent
  credential and no client-side secret storage. It tells the agent to have the
  user create a scoped, expiring key, keep it in the environment or a secret
  manager, and never echo it.
- `block_api_write` is stored lazily on the page aggregate: absent means
  unlocked, only `true` is ever persisted, clearing it removes the field, and
  trial pages must never carry it. Every page written before the flag existed
  stays writable.
- Enforcement lives in `PageService`, not the HTTP adapter. The adapter marks
  the actor with `via_api_key` when the principal is a key; the service refuses
  update, re-link, rename, duplicate, delete, and the per-item bulk operations
  with `api_write_blocked` (`403`). Reads are never blocked. A duplicate of a
  locked page inherits the lock.
- Only a browser session may change the flag. `block_api_write` in a PATCH body
  from a key returns `protection_requires_session` (`403`) before any
  persistence, so a key can neither unlock a page nor lock one for its owner.
- Page management renders the control as an explicit labelled checkbox with its
  consequence in the label area, plus a row indicator while it is on.

## Optional follow-ups

Per-namespace or per-page key scoping (grants are still owner-wide); a
`last_used_at` signal for keys handed to agents; an MCP transport over the same
`AgentSkillSource` and `PageService`.
