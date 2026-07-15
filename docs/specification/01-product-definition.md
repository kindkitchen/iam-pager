# Product definition

## Problem statement

Publishing a small piece of content at a memorable, stable address often
requires either a full website or a provider-specific sharing flow. Consumers
then encounter platform UI, unclear access behavior, or links coupled to a
storage vendor.

`iam-pager` aims to let a creator associate content with a controlled locator
and let a visitor receive that content with minimal platform interference. The
same service provides a separate surface for ownership, management, and eligible
public discovery.

The target users, strongest initial use cases, and acceptable content classes
are still Open. They must be validated before the project claims a specific
market or scale.

## Product thesis

- **PR-001 — Baseline:** A page is valuable primarily because its locator is
  stable and its delivery behavior is predictable.
- **PR-002 — Baseline:** Direct content delivery and site-based management are
  separate experiences, even when backed by the same page record.
- **PR-003 — Baseline:** A creator controls page content and metadata within
  platform policy; the platform does not assign meaning to the content.
- **PR-004 — Proposed:** Page identity should remain independent from the
  location of stored content so storage can evolve without unnecessarily
  changing public locators.
- **PR-005 — Baseline:** Ownership, visibility, and trust boundaries must be
  explicit. Convenience must not permit one creator to replace or disclose
  another creator's content.

Creator responsibility does not remove platform responsibility. The service
still needs enforceable rules for illegal, harmful, deceptive, or abusive
content and for the security effects of delivering active content.

## Intended actors

| Actor                          | Intended outcome                                                   | Status                                                |
| ------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------- |
| Visitor                        | Open a known locator and receive content or an explicit failure    | Baseline                                              |
| Explorer                       | Find and inspect pages that are eligible for public discovery      | Baseline, breadth Open                                |
| Authenticated creator          | Own namespaces and manage pages throughout their lifecycle         | Baseline                                              |
| Guest creator                  | Publish without an account under bounded ownership and abuse rules | Proposed, blocked                                     |
| Provider-connected creator     | Bind pages to content held by an external provider                 | Deferred                                              |
| Platform operator or moderator | Enforce policy, investigate abuse, and operate the service safely  | Baseline requirement missing from the original vision |

## Goals

- **PR-010 — Baseline:** Resolve a canonical page locator deterministically to
  one authorized page outcome.
- **PR-011 — Baseline:** Deliver supported content without forcing the visitor
  through the site's navigation or visual shell.
- **PR-012 — Baseline:** Give authenticated creators durable control over their
  namespaces and pages, subject to an explicit retention and policy contract.
- **PR-013 — Baseline:** Support a site-mediated view that can present page and
  creator context without changing the direct-delivery contract.
- **PR-014 — Proposed:** Make explicitly listed public pages discoverable by
  useful metadata before considering full-content search.
- **PR-015 — Deferred:** Allow external content storage without weakening the
  page's access, integrity, or lifecycle contract.

## Non-goals for the initial product boundary

These are Proposed boundaries and should be confirmed with MVP scope:

- social networking features such as follows, comments, or reactions;
- collaborative editing or simultaneous authorship;
- arbitrary server-side code execution supplied by creators;
- replacing a general-purpose storage provider or source-control system;
- promising permanent archival storage;
- full-content indexing for every media type;
- anonymous publishing before ownership recovery, collision prevention, abuse,
  quota, and deletion behavior are defined;
- external provider integration before authority and synchronization semantics
  are defined.

## Product principles

1. **Explicit outcomes over silent fallback.** A missing, private, removed, or
   failed page must have distinguishable platform behavior, even if disclosure
   rules intentionally make some visitor responses look the same.
2. **Stable identity, controlled mutation.** Content may change, but locator
   changes, redirects, reuse, and deletion require explicit lifecycle rules.
3. **Least platform interference.** Direct delivery preserves supported content
   semantics while applying necessary safety and protocol controls.
4. **No implied trust.** Public content is not necessarily safe, endorsed, or
   eligible for discovery.
5. **Progressive scope.** Authenticated first-party publishing is the candidate
   core. Guest publishing, full-content search, and external storage must earn
   their complexity through validated need.
6. **Outcome-led technology.** Technical choices must be evaluated against the
   delivery, isolation, integrity, and operability requirements in this
   specification.

## Success definition

The initial coherent product succeeds when an authenticated creator can own a
namespace, manage a supported piece of content, choose its access state, and
share a locator whose direct response is predictable; a visitor either receives
that response or an intentional failure outcome.

Measures remain Open. Before production planning, define at least:

- successful locator-resolution and delivery rates;
- acceptable latency and content-size bands;
- creator completion and repeat-use signals;
- abuse, report, and unauthorized-access indicators;
- retention and recovery expectations;
- discovery usefulness, if discovery enters the initial scope.
