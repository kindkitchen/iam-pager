---
name: external-storage-spec
description: Step 1 of external-content-storage - write the product and technical specification for externally stored content. Load when defining scope, invariants, or docs for external storage.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, docs]
relates: [external-content-storage]
---

Write the specification before any code: what "external content source" means
for pages, assets, delivery, and failure modes. Output is docs, not code.

Deliverables: new `docs/specification/external-storage.md`; updates to
`docs/specification/pages.md`, `capabilities.md`, `open-scope-and-risks.md`;
README product-boundary touch-up; CHANGELOG entry.

Key decisions to settle (record each as a decision entry):
- visitor behavior when external bytes are gone (placeholder page vs
  non-disclosing 404) and how that coexists with the existing 404 invariant;
- metadata custody line (what we cache: media_type, size, checksum, filename);
- provider capability set v1 (read mandatory; write/delete optional);
- token custody and revocation posture.

Next: start with the failure-mode decision; it constrains every later task.
