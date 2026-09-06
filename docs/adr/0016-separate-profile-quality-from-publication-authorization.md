---
status: accepted
---

# Separate profile quality from publication authorization

Source Profile validation is evidence for an Operator's decision rather than a mandatory
field-quality or sample-count threshold: a limited sample or unsupported page should not prevent
useful extraction from the rest of a Source. Operators may explicitly approve a technically safe,
executable profile for publication review or automatic publication despite quality failures, while
individual candidates retain mandatory publication checks and unexpected failures remain visible
exceptions. This accepts greater reliance on Operator judgment and trust in a particular Source
and profile version in exchange for automation, preserving the human authorization boundaries of
[ADR-0014](0014-human-gate-source-fetching-and-profile-changes.md); technically valid LLM repairs
remain reviewable draft versions even when field validation fails.

The [consolidated design](../design/source-profile-flexibility.md) records the agreed UX and
operational behavior, published as [implementation issue #118](https://github.com/pooya79/TorobRent/issues/118).
This records the agreed policy; implementation is tracked by that issue.
