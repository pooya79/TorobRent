# Imperfect Source Profile repairs (#121)

Explicit LLM repairs with safe executable rules now create immutable drafts even when selected or
unrelated fields fail quality checks. Malformed and unsafe output remains an unsuccessful recorded
attempt. Approval still requires an explicit publication mode and acknowledgement of limitations
with a reason; repairs never replace the active version.

The Operator comparison includes changed rules, before/after independent-validation counts and
coverage, sample values and conflicts, and affected page URLs. Sample transitions are labeled as
improvements, regressions, or other changes; training and held-out pages remain distinct. Comparisons
are derived from retained immutable version evidence, without network access or historical rewrites.
The API contract and generated client include this evidence. Existing storage is sufficient, and
Django's migration drift check reports no changes.

## Validation

- Full backend suite on PostgreSQL: 638 passed; coverage 92.37% (85% required).
- Full frontend suite: 273 passed, with the 16 baseline failures below and no new failures.
- Focused repair API suite on PostgreSQL: 32 passed.
- Focused Operator Source Proposal React suite: 17 passed.
- Lint, formatting, mypy, TypeScript, API generation/drift/lint, and production build passed.
- The starting commit, `0089079`, reproduces 16 existing frontend failures in OperatorWorkspace,
  OperatorOverviewPage, OperatorReviewPage, OperatorSupportPage, and ResultsPage. These concern
  unrelated workspace text and results-grid expectations; those test files are unchanged.

## Review

Independent Standards and Spec reviews found no issues.

## Screenshots

Captured from the actual review component using deterministic fixtures, without changing a real
Source. Desktop (1440px) and mobile (390px) were visually checked, with no horizontal overflow.

- [Desktop comparison](screenshots/issue-121-comparison-desktop.png)
- [Mobile comparison](screenshots/issue-121-comparison-mobile.png)
