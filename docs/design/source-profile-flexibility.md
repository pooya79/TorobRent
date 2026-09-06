# Flexible Source Profile approval

All discussion rounds are agreed and synthesized into
[implementation issue #118](https://github.com/pooya79/TorobRent/issues/118).
This describes intended behavior; it is not a claim about current code.

## Agreed direction

- An Operator may approve a Source Profile despite incomplete or conflicting field-validation
  results. Technical rule safety and executability remain prerequisites.
- Validation evidence remains visible. An unsupported page may be excluded with a reason; a valid
  rental page whose extraction fails remains evidence of an extraction problem.
- When publication review is required, candidates remain unpublished until Operator approval.
  Automated checks alone do not establish factual correctness.
- Automation is a primary objective, including anticipated scheduled Extraction Runs. Approval
  should not imply permanent careful review of every candidate; trust in the Source Representative
  must have an explicit role in the design.
- Operators need a way to inform the Source Representative about website problems, request action,
  or reject the Source Proposal.
- Operators can choose publication approval or automatic publication despite profile field-quality
  failures. Individual candidates still must pass publication checks. An Operator can start with
  publication approval and later enable automatic publication.
- Automation authorization applies to one Source and approved Source Profile version, not globally
  to the Submitter. A different Source or changed profile needs explicit approval.
- A Submitter may have one current website, counting an open Source Proposal or active Source
  Assignment. Rejected or discarded proposals do not consume the slot. Replacing an approved
  website requires ending its assignment first, including the existing withdrawal consequences.
- Enabling automatic publication applies to newly requested runs. Existing candidates stay pending;
  an explicit bulk approval action can publish valid pending results.
- Operators can define Source Exclusions using exact URLs or URL path prefixes, with a reason and
  matching examples shown before saving. Excluded pages are skipped with a recorded reason.
  Unexpected extraction failures remain visible exceptions and do not block other valid candidates.
- Exclusion previews include affected published Listings. Applying an exclusion affects future
  processing; withdrawing existing Listings is a separate explicit action.
- A replyable conversation belongs to the Source Proposal and is accessible from the source screen
  and Message Center. Sending a message does not change approval or extraction state. Request
  Changes and Reject remain separate decisions on pending proposals, with reasons. Approved
  sources retain messaging; pausing their extraction is a separate explicit decision.
- Pausing a Source stops new extraction and prevents unfinished work from publishing. Existing
  published Listings retain their normal availability behavior; withdrawal is separate. An Operator
  must explicitly resume the Source. Pausing does not revoke the Source Assignment.
- Repeated failures maintain one current exception per Source URL, with first occurrence, latest
  problem, and last attempt. The queue groups exceptions by problem and supports bulk actions.
  Notifications highlight new problems or material worsening, not every repeat. Valid candidates
  continue publishing according to the selected mode; failures alone do not automatically pause
  the Source. A run with no usable results gets a prominent warning.
- Initially, representatives fix their website and request re-extraction, or explain corrections
  through the Source Conversation. Operators can correct candidates; representatives do not
  directly edit extracted facts inside TorobRent.
- Technically valid LLM repairs are retained as draft Source Profile versions even when field
  validation fails. Review shows before/after improvements, regressions, and affected pages.
  The active version stays unchanged until explicit approval and publication-mode selection.
  Malformed or unsafe output remains an unsuccessful repair attempt.
- A draft profile may be built from fewer than ten usable pages. Review shows actual training and
  independent-validation counts, with no page counted in both. Limited samples are labeled Limited
  evidence; a one-page proposal explicitly has No independent validation. Either publication mode
  remains available with acknowledgement. With no usable pages, request another example URL or
  website changes.
- Disabling automatic publication takes effect immediately for queued and running work that has
  not published. Published Listings are unchanged. This is deliberately stricter than enabling it.
- Source Exclusions are separately recorded restrictions. Adding one immediately blocks matching
  unpublished candidates from publication. Removing one allows future extraction, without
  automatically publishing old candidates. Operator confirmation applies the restriction without
  another profile approval.
- Exact exclusions match normalized URLs including meaningful query parameters. Path prefixes
  match path sections rather than similarly named sections, and rules stay within the assigned
  website. Preview shows known matching pages and explicitly reports when none are known.
- Each Source has a responsible Operator, initially its approver, who receives conversation and
  exception notifications. An authorized queue manager can reassign responsibility while preserving
  history. Other Operators need the relevant capability and must take responsibility before source
  decisions; independent-review restrictions remain.
- The representative sees Contact review team and receives notifications of replies and decisions.

- Resuming a paused Source or approving a different profile starts fresh extraction with the current
  profile and exclusions. Old unfinished results do not automatically publish. They remain in
  history, and fresh results replace their pending review items as they arrive.
- Fresh extraction that passes candidate checks automatically resolves the URL's extraction
  exception, independently of publication approval. A later failure reopens it with history.
  Exclusion is labeled Excluded, not successful extraction. Manual candidate correction clears that
  candidate's blocker without declaring its underlying extraction problem fixed.
- Messages, review decisions, pause/resume, and publication-mode changes generate immediate
  notifications. New, resolved, and reopened exceptions are grouped into one daily source summary
  only when something changed. A run that attempts non-excluded pages but produces no usable
  results alerts the responsible Operator immediately; repeat alerts are suppressed until recovery.
  Source screens always show current counts. Representatives can inspect affected pages but receive
  technical exception notifications only when an Operator explicitly requests action.
- Initial implementation covers representative-triggered requests. Scheduling configuration is a
  separate feature, with frequency, starting URLs, and fetch budgets to be designed there. These
  source controls must apply equally to future scheduled runs.

## Consolidated user flow

1. The Submitter introduces their one current website and confirms their authority. Existing draft
   and pending cases are resumed instead of opening a second website case.
2. The responsible Operator approves the URL before discovery. Discovery proposes a draft profile
   using available evidence, clearly reporting limited or absent independent validation.
3. Profile review shows sample outcomes, unresolved fields, and repair comparisons. The Operator
   may repair rules, define exclusions, discuss problems, request changes, reject the proposal, or
   approve with publication review or automatic publication. Quality failures remain visible but
   do not prohibit approval; unsafe or non-executable rules do.
4. The representative requests extraction. The source screen shows publication mode, source status,
   run history, excluded pages, current exceptions, and Contact review team.
5. Valid candidates publish according to the mode. Unexpected failures enter a grouped exception
   queue; excluded pages are recorded separately. Operators can approve valid pending results,
   correct candidates, repair rules, or ask the representative to fix the website and retry.
6. Operators can change publication mode, pause/resume, manage exclusions, and communicate without
   conflating those actions. Withdrawals and replacement of an assigned website are explicit.

No product questions remain from the discussion rounds. The API workflow and focused React test
boundaries were explicitly confirmed during specification. Implementation details and tests must
preserve these agreed behaviors.

## Existing decision boundary

[ADR-0014](../adr/0014-human-gate-source-fetching-and-profile-changes.md) requires Operator approval
before fetching a submitted Source and before applying a changed Source Profile. This discussion
does not yet change that decision.

Existing review decisions send non-replyable notifications containing the Operator's reason.
There is no Source Proposal conversation today. Stored profile exclusions are discovery evidence,
not enforced page-ignore rules. Recurring extraction is future scope; current requests are
representative-triggered.
