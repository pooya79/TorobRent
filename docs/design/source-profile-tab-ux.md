# Source Profile tab UX

Status: implemented after explicit confirmation through the implement skill;
standards and spec reviews completed.

## Agreed scope and direction

- Improve only the Profile tab on the Operator Source Proposal detail page.
- Explain the Source Profile's purpose, show extracted evidence and problems, and
  make the next available actions understandable within that tab.
- Make the primary experience usable by Operators without knowledge of selectors
  or extraction configuration. Keep technical inspection and editing available as
  secondary tools.
- Use the existing Source Profile definition in `CONTEXT.md`; no domain terminology
  change has been agreed.
- Rename the tab to «استخراج اطلاعات», retaining «روش خواندن اطلاعات از سایت»
  as its internal heading.
- Review one sample page at a time through a page selector, grouped extracted
  information, and evidence beside each value. A compact summary highlights
  problems across all samples.
- Let Operators select incorrect or missing fields alongside their results and
  request AI repair. Explain that repair changes extraction rules rather than
  editing sample facts. Keep manual rule editing in advanced controls.
- Open repaired drafts with before/after values for affected fields, highlighting
  improvements, regressions, and unchanged problems. Distinguish the active version
  from the draft under review and collapse full version history by default.
- Provide a visible Review and activate action opening a decision panel that
  explains activation, offers publication review or automatic publication, and
  presents remaining problems requiring acknowledgement. Approval must not imply
  that all extracted information has been verified correct.
- For active profiles, show the active version and available sample evidence with
  an Improve extraction entry into the existing review workflow where permitted.
  Explain unavailable actions according to their actual cause. The active version
  remains in use until a replacement is approved.
- Label field results Extracted, Missing, or Needs attention, with specific
  explanations supported by the available evidence. Successful extraction does
  not establish correctness. Distinguish absent source information from extraction
  failure only when the evidence establishes that distinction.
- Show a short source-text excerpt where available beside each extracted value
  and link to the original page. Explicitly label unavailable evidence. Put
  selectors, JSON paths, and raw diagnostics in expandable technical details.
- Explain empty and failure states accurately and present the next available
  action. Keep existing evidence visible during repair with progress feedback.
  Failed repairs preserve field selection and show the reason and a retry action
  where permitted.
- On mobile, stack values and evidence while keeping decision actions easy to reach.

## Before the redesign

`frontend/src/features/source-proposals/SourceProfileReview.tsx` already explains
the profile as the method for reading information from a website. Its primary
layout presents a long evidence report alongside a decision and repair sidebar.
Extracted values, evidence snippets, extraction rules, and repair controls are
separated, requiring Operators to connect them themselves. On narrow screens,
actions follow the evidence report.

## Final review

All interview choices above were confirmed for implementation. This work is limited
to the Profile tab, its label,
and its entry into the existing review workflow; other proposal tabs are outside
the redesign scope. It does not introduce new approval or publication policies.

Existing approval and publication boundaries remain governed by
[ADR-0014](../adr/0014-human-gate-source-fetching-and-profile-changes.md) and
[ADR-0016](../adr/0016-separate-profile-quality-from-publication-authorization.md).
No change to those policies has been agreed in this interview.


## Implementation and validation

- Sample pages have grouped fields, adjacent readable evidence, original-page links,
  and inline repair selection. Show all fields reveals absent optional fields.
  Unknown values are not labeled successfully extracted. Raw evidence and full
  snippets remain available in technical details.
- Repair and activation panels open explicitly, receive focus, and scroll into view.
  Their sticky controls clear the existing mobile header and proposal tabs.
- History remains deferred and paginated. Repair failures retain selection; new
  versions reset decision acknowledgements. Existing API approval guards remain.
- Standards review: no findings. Spec review: optional-field visibility and specific
  unavailable-action reasons were corrected; re-review found no remaining findings.
- Desktop (1440 px) and mobile (390 px) browser checks covered field/evidence layout,
  sticky actions, and opening repair panels. The temporary editable-profile visual
  fixture was removed after checking; seeded Source data was not changed.
- Frontend: 457 tests passed across 55 files, including the proposal screen and queue
  navigation tests. Lint, formatting of changed files, TypeScript, and production
  build passed. Backend mypy and Ruff passed.
- Full backend suite: 986 passed, 58 PostgreSQL-only tests skipped; coverage 93.24%.
  The skipped cases were then run against isolated PostgreSQL test databases:
  53 passed and five failed. Backend code and tests are unchanged from the confirmed
  baseline `6361efce02f0b131a0af2893691dd2529a261cab`.

The unrelated PostgreSQL failures remain outside this UI change:

- `tests/test_extraction_requests.py::test_concurrent_delivery_rechecks_extraction_and_publication_authority`
  (`mode-automatic`, `mode-approval_required`): expected ten retained results, received zero.
- `tests/test_property_match_operations.py::test_overlapping_operation_deliveries_are_serialized_by_postgresql`:
  expected an additional evaluation, count stayed unchanged.
- `tests/test_source_revocation.py::test_revocation_during_inflight_extraction_discards_stale_results`
  (`automatic`, `approval_required`): request and run cancellation states differed.
