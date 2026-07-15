# REFINE — critical review of the generated specification

Scope of this review: `README.md` and `docs/specification/*` as generated from
the original draft README, checked against that original text.

## Verdict

The specification is rigorous, safety-aware, and correctly kills the genuinely
dangerous parts of the original vision (guest overwrite, fallback-to-home,
absolute retention promise, public/private conflation). But it overshoots the
project's stage: it is a production-governance document for a product that has
not validated a single user journey. As written, no line of product code can be
started — every delivery slice is blocked, and the spec's own rules forbid
filling gaps with assumptions. It also quietly makes real scope decisions while
claiming to make none, and it drops one explicit direction of the original
vision entirely (the API surface).

## What holds up

- The "Required corrections" table in `06-open-questions-and-risks.md` is the
  strongest artifact: every correction is justified and traceable.
- Separating page / locator / content / content binding (03) is a real modeling
  improvement over the original's conflation.
- Access vs listing vs policy eligibility vs availability (DM-040..043) fixes a
  flaw the original didn't know it had.
- Stable requirement IDs and the decision-ordered question list are usable.

## Critical issues

### 1. The spec makes everything unstartable

19 open questions, and every slice (DS-00..DS-07) is gated on several of them.
DS-00 alone demands answers to nine product questions — including
product-market questions (Q-001) that no document process can answer — before
any implementation slice is "ready". Combined with the rule that "an open point
must not be filled by an implementer's assumption", the spec forbids the one
activity that would actually answer Q-001/Q-005/Q-011: building and using a
prototype. There is no sanctioned prototype tier. For a solo, pre-MVP project
this is waterfall discovery dressed as rigor.

**Refinement:** add an explicit two-tier regime: (a) prototype decisions —
assumptions allowed, recorded, reversible, never a compatibility promise; (b)
production blockers — the current gating. Most of Q-008..Q-013 can be answered
provisionally in tier (a).

### 2. The spec claims neutrality but encodes a scope reversal

The original vision leads with the unauthenticated user; guest content creation
is a first-class scenario there. The spec demotes guest publishing to
"Proposed, blocked" and installs authenticated-first publishing as the
"recommended working assumption". The safety reasoning is sound, but this is a
product decision, not a correction, and the framing (blocked capabilities,
"should omit rather than ship") makes the reversal feel settled. The document
that says "an open point must not be filled by an implementer's assumption"
filled the biggest open point itself.

**Refinement:** either get explicit owner sign-off on the auth-first boundary
(then mark it Baseline honestly), or present guest-first and auth-first as two
candidate boundaries under Q-002 with equal visibility.

### 3. The API direction of the original vision is gone

Original: "The first direction is mostly api focused except some ways of
display the content." The spec has no API capability anywhere — `API` appears
once, incidentally, in DM-013. Programmatic page creation/management (curl a
file to a locator, CI publishing, etc.) is plausibly the core differentiator
versus a static host, and it directly bears on Q-001. Its silent disappearance
is the largest untracked coverage gap.

**Refinement:** add a capability group (or an explicit Deferred/Open entry) for
a programmatic management surface, and add it to the corrections/traceability
discussion so the omission is a decision, not an accident.

### 4. Lost rationale behind the storage-provider feature

The original motivates external providers with "because pages can have
different formats, purposes, sizes". Deferring providers (correct) also
silently deferred the underlying need — flexible content size/format support —
which is now only implicit inside Open Q-005/DM-032. The need should survive
the deferral of its proposed mechanism.

**Refinement:** capture "support varied content classes and sizes beyond a
trivial cap" as a product-level requirement (even if Open in its bounds), so
Q-005 is answered against a stated need rather than in a vacuum.

### 5. Baseline requirements that cannot be exercised

Many Baselines are only vacuously verifiable because they depend on Open
decisions: EX-002 (delivery per declared metadata — but the content contract
DM-032 is Open), CP-606 (Core, "under the eventual privacy and retention
contract" — a Core capability defined by an undecided contract), DM-030/031
(validated metadata for an undefined media set). "Baseline — clarified
sufficiently to shape work" is not true for these; they shape nothing until
their Opens resolve. The status vocabulary is cleaner than its application.

**Refinement:** either downgrade such items to Proposed, or annotate Baselines
with their blocking question IDs so "Baseline but blocked" is visible.

### 6. Slice order defers the highest-risk learning

DS-01 (accounts/namespaces) precedes DS-03 (direct delivery). Auth is commodity
work; direct delivery plus active-content isolation (Q-015 — the top risk in
the register) is where the product thesis (PR-001, PR-011) lives or dies. The
current order spends the first slice on the least-informative component.

**Refinement:** allow DS-03 to run first against a stubbed identity, or state
explicitly why authority must precede delivery validation.

### 7. Concrete defects

- **Cross-reference bug:** `04-capabilities.md` says external providers are
  "blocked by Q-008" — Q-008 is locator grammar; provider semantics is Q-018.
- **Off-vocabulary statuses:** EX-205 uses "Baseline if accepted"; the actor
  table in 01 uses a prose sentence as a status. Both violate the declared
  status vocabulary in the spec README.
- **Range shorthand over nonexistent IDs:** DS-03 cites "TR-040 through
  TR-054" (TR-044..049 do not exist) and "DM-030 through DM-043" (DM-036..039
  do not exist). Harmless today, ambiguous the moment those IDs get allocated.
- **TR-002 vs TR-004 tension:** the stack is simultaneously a Baseline
  constraint and a thing to validate. Also unflagged: the chosen framework
  itself constrains Q-008 — Fresh's route table and asset paths (e.g.
  `/_fresh/*`) are de facto reserved locator names, which DM-013/DM-015 should
  name explicitly.
- **Original vision not preserved:** the draft README was overwritten and
  survives only in git history. For a spec that leans on "required corrections
  to the original vision", the original should be archived (e.g.
  `docs/vision-draft.md`) and the corrections table should link claim → source.

### 8. Process weight per task

The task-readiness checklist (spec README) plus the ten-point task-shaping
checklist (07) require every task to address security, privacy, abuse,
lifecycle, observability, compatibility, and rollback. For production slices,
fine. Applied uniformly, it taxes trivial work and will be ignored in practice
— which then erodes the checklist where it matters.

**Refinement:** scale the checklist by risk class; state which items are
mandatory only for delivery-boundary and authority-boundary changes.

## Suggested next actions (ordered)

1. Fix the Q-008/Q-018 cross-reference and off-vocabulary statuses (mechanical).
2. Restore the original vision as an archived doc; add claim → requirement
   traceability to the corrections table, including the dropped API direction.
3. Decide the prototype-tier policy (issue 1) — this unblocks everything else.
4. Get an explicit owner decision on Q-002 (auth-first vs guest-first) instead
   of a working assumption that behaves like one.
5. Re-order or justify slice sequencing around Q-015/delivery risk.
