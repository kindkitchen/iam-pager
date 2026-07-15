# Project specification

Status: initial working specification\
Last reviewed: 2026-07-15

## Purpose

This specification turns the original project vision into a source of truth from
which decisions, delivery slices, and implementation tasks can be derived. It
defines intended outcomes and constraints without prematurely selecting
architecture or vendors.

The specification is deliberately incomplete where product intent is not yet
safe or precise enough. An open point is part of the specification; it must not
be filled by an implementer's assumption.

## Authority

For product and technical scope, these files take precedence over summaries in
the top-level `README.md`. When specification files conflict:

1. an explicitly accepted decision takes precedence;
2. an open question prevents the affected behavior from being assumed;
3. the narrower requirement takes precedence only when its status is equally
   clear;
4. otherwise, record and resolve the conflict before implementation.

Changes to accepted behavior must update the affected specification files,
`README.md` when its summary changes, and `CHANGELOG.md` in the same change.

## Status vocabulary

- **Baseline** — carried forward or clarified sufficiently to shape work.
- **Proposed** — recommended direction requiring product confirmation.
- **Open** — a decision is required; no behavior may be inferred yet.
- **Must change** — an earlier statement is unsafe, contradictory, or not
  testable and is excluded from the baseline.
- **Deferred** — valid candidate behavior outside the initial product boundary.

`MUST`, `SHOULD`, and `MAY` apply only to Baseline requirements unless a section
states otherwise. They describe observable properties, not implementation
choices.

## Specification map

| File                                                                                 | Purpose                                                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| [01-product-definition.md](01-product-definition.md)                                 | Problem, goals, principles, actors, boundaries, and success |
| [02-experiences-and-scope.md](02-experiences-and-scope.md)                           | User journeys, visibility, and scope by actor               |
| [03-domain-and-addressing.md](03-domain-and-addressing.md)                           | Terms, identity, locator, content, and lifecycle rules      |
| [04-capabilities.md](04-capabilities.md)                                             | Observable platform capabilities and priority               |
| [05-quality-and-technical-requirements.md](05-quality-and-technical-requirements.md) | Quality constraints and technical decisions to investigate  |
| [06-open-questions-and-risks.md](06-open-questions-and-risks.md)                     | Blocking questions, required corrections, and risk register |
| [07-delivery-slices.md](07-delivery-slices.md)                                       | Coherent increments from which tasks can be shaped          |

Requirement identifiers are stable references for discussion and tasks: `PR`
product, `EX` experience, `DM` domain, `CP` capability, `TR` technical, `Q` open
question, and `DS` delivery slice.

## Turning the specification into tasks

A task is ready to define only when it:

- names one actor outcome and links the relevant requirement identifiers;
- does not depend on an unresolved blocking question;
- states acceptance examples and failure behavior without prescribing an
  unvalidated design;
- covers security, privacy, abuse, lifecycle, and observability consequences;
- identifies affected documentation and compatibility expectations;
- is small enough to review and verify independently.

Use [the delivery slices](07-delivery-slices.md) as boundaries, not as a
backlog. Each slice still needs decomposition after its decisions and acceptance
evidence are agreed.
