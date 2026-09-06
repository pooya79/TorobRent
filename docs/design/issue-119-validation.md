# Source Profile approval with quality limitations (#119)

Operators can approve safe, executable profiles in either publication mode after reviewing
advisory evidence. Known limitations require acknowledgement and a recorded reason, including
individual sample failures when the aggregate quality threshold passes. Candidate publication
checks remain mandatory.

## Validation

- Full backend suite on PostgreSQL: 623 passed; coverage 91.94% (85% required).
- After the review fix, focused profile workflow and repair suites on PostgreSQL: 58 passed.
- Focused React review interactions: 13 passed, covering both modes and both quality outcomes.
- Lint, formatting, mypy, TypeScript, migration drift, OpenAPI generation/lint, and production build
  passed. Generated client types are committed with the API contract.
- Full frontend suite: 269 passed, 16 failed in five unchanged test files (OperatorWorkspace,
  OperatorOverviewPage, OperatorReviewPage, OperatorSupportPage, ResultsPage). These existing
  failures concern workspace text and results-grid expectations and also reproduce at the starting
  commit, `73f9097`.

## Standards review

No documented-standard breaches. One optional maintainability finding: two workflow tests repeat
setup of a limited-quality profile; a small fixture helper could consolidate it. The explicit
scenario setup is retained for readability.

## Spec review

One finding was fixed: a single missing sample field could fall within the aggregate 80% threshold
and bypass acknowledgement. Limitations now include all training and held-out sample findings,
independently of that threshold. Re-review found no remaining blocking Spec findings.

## Screenshots

Captured with fixture responses in an isolated preview of the actual review component; no real
Source was approved. Desktop (1440px) and mobile (390px) were visually checked without horizontal
overflow.

- [Desktop evidence](screenshots/issue-119-evidence-desktop.png)
- [Mobile evidence](screenshots/issue-119-evidence-mobile.png)
- [Desktop approval](screenshots/issue-119-approval-desktop.png)
- [Mobile approval](screenshots/issue-119-approval-mobile.png)
