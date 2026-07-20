---
name: pdf-content-core
description: Implement PDF as a specific content capability over shared page/content/endpoint contracts. Load when working on PDF validation, metadata, supported delivery profiles, or preview-versus-download behavior.
created: 2026-07-20
updated: 2026-07-20
tags: [backend, content, pdf, interfaces]
relates: [content-endpoint-bindings, kvdex-content-persistence, pdf-content-http]
---

Todo, chain position 2 of 5. Blocked by `content-endpoint-bindings`.

Next: implement a transport-independent PDF handler after generic user-configured
endpoint contracts are accepted. PDF declares supported delivery profiles but
does not generate or interpret locators. See [[001.draft]] and the superseding
[[002.decision]]. Generic binary content and browser UI remain outside this task.
