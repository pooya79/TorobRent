# Issue #129: grouped Source actions

Operators can select up to 20 current pages of one Source, preview publication eligibility and
exclusion impact, then explicitly publish valid pending candidates, exclude exact URLs, or send a
representative action request through Source Conversation. Preview tokens expire after 15 minutes
and bind the actor, Source, selected pages, action, reason, and current state. Applying a preview
rechecks the state under the proposal and Source locks. A retained action record prevents replay.

Existing candidate evidence and correction controls remain available from the group. Correcting
one candidate does not repair the Source Profile. Published Listings are not withdrawn by adding
an exclusion; that remains a separate existing action.

Screenshots use deterministic fixtures with the production component:

- [Publication preview](screenshots/issue-129-bulk-publication.png)
- [Exclusion preview](screenshots/issue-129-bulk-exclusion.png)
- [Mobile exclusion preview](screenshots/issue-129-bulk-mobile.png)

Candidate correction is available directly inside the preview, including valid candidates and
results outside the recent-run window. The explicit correction claim retains the existing
independent-review and responsibility checks. Ordinary valid candidates still cannot bypass bulk
publication through the individual approve endpoint.

## Validation

The standards and spec reviews both have no remaining findings. The spec review identified an
older-result navigation gap, which was resolved with embedded candidate evidence and correction.

The production frontend build passed from an isolated copy: the checkout's pre-existing
`frontend/build` directory is owned by `nobody` and cannot be replaced by the current user.

The frontend suite has 16 pre-existing failures, reproduced unchanged at starting commit
`9c91e36eb5184be4e6a655c3d661b4fba57f5b7b`, in these files:

- `OperatorWorkspace.test.tsx` (1)
- `OperatorOverviewPage.test.tsx` (2)
- `OperatorReviewPage.test.tsx` (5)
- `OperatorSupportPage.test.tsx` (7)
- `ResultsPage.test.tsx` (1)

Final focused validation passes: 43 PostgreSQL tests covering bulk actions and existing publication
safeguards, and 37 React tests covering the grouped workflow and existing Source UI. Ruff,
frontend lint/style/asset checks, formatting, backend/frontend types, API regeneration/drift/lint,
and migration drift checks pass.

The full PostgreSQL backend suite passes: 766 tests, 92.67% coverage (minimum 85%).
