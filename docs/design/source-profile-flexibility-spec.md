## Problem Statement

Source Representatives can introduce useful rental websites whose pages are not perfectly uniform.
Today, too few sample pages or one conflicting validation field can prevent approval of an entire
Source Profile. A technically valid LLM repair can also be discarded because unrelated fields still
fail validation. Operators cannot use the useful results while containing failures to individual pages.

Requiring careful review of every result indefinitely would create an unsustainable workload as
extraction becomes recurring. Operators need explicit control over trust in a particular Source and
profile version, clear exceptions, enforceable exclusions, and a way to discuss website problems with
the representative. Approval, messaging, pausing, and withdrawing published Listings must have
distinct and predictable effects.

## Solution

Make profile field-quality validation advisory while preserving mandatory rule safety, human profile
approval, and individual candidate publication checks. Retain imperfect but technically valid draft
profiles, report evidence honestly, and let an Operator choose Requires publication approval or
Publish valid results automatically. Support switching modes, source pause/resume, explicit Source
Exclusions, a replyable Source Conversation, and a grouped exception queue that avoids duplicate work.

Allow one current website per Submitter. Scope automation authorization to that Source and approved
profile version. Apply these controls to representative-triggered Extraction Requests now, with the
same semantics available to future scheduled runs; schedule configuration is a separate feature.

## User Stories

1. As a Submitter, I want to introduce one current website, so that responsibility for my Source is clear.
2. As a Submitter, I want to resume my existing draft or pending proposal, so that I do not create competing website cases.
3. As a Submitter, I want a rejected or discarded proposal to free my website slot, so that I can introduce a replacement.
4. As a Source Representative, I want replacing an approved website to explain assignment revocation and listing withdrawal, so that I understand the consequences.
5. As an Operator, I want to approve a submitted URL before discovery, so that outbound access remains explicitly authorized.
6. As an Operator, I want a draft profile from fewer than ten usable pages, so that small websites are not automatically excluded.
7. As an Operator, I want actual training and independent-validation counts, so that I can judge the strength of the evidence.
8. As an Operator, I want a one-page profile labeled No independent validation, so that reused evidence is not presented as independent proof.
9. As a Source Representative, I want an actionable request for another example URL or website changes when no usable page exists, so that I know how to proceed.
10. As an Operator, I want page-by-page results and field conflicts, so that a problematic sample does not obscure useful extraction elsewhere.
11. As an Operator, I want to approve an executable profile despite field-quality failures, so that imperfect extraction can still be useful.
12. As an Operator, I want unsafe or malformed rules to remain unapprovable, so that quality flexibility does not bypass execution restrictions.
13. As an Operator, I want to acknowledge known limitations when approving, so that my decision records what I accepted.
14. As an Operator, I want to choose either publication mode immediately, so that trust and evidence can guide the decision without a mandatory probation stage.
15. As an Operator, I want to start with publication approval and later enable automation, so that oversight can decrease as confidence grows.
16. As an Operator, I want automation authorization scoped to one Source and profile version, so that trust does not silently transfer to other websites or changed rules.
17. As an Operator, I want valid pending candidates available for explicit bulk approval, so that supervision does not require repetitive individual actions.
18. As an Operator, I want invalid candidates excluded from bulk publication until corrected, so that bulk actions preserve publication checks.
19. As an Operator, I want enabling automation to leave existing results pending, so that a mode switch does not unexpectedly publish a backlog.
20. As an Operator, I want disabling automation to affect queued and running work immediately, so that no further automatic publication escapes the restriction.
21. As an Operator, I want technically valid LLM repairs saved as draft versions despite validation failures, so that useful improvements are not discarded.
22. As an Operator, I want a before/after repair comparison showing improvements and regressions, so that I can make an informed approval decision.
23. As an Operator, I want the active profile unchanged until I approve a draft, so that experiments do not alter live extraction.
24. As an Operator, I want to exclude an exact URL or path section with a reason, so that unsupported pages can be intentionally skipped.
25. As an Operator, I want exclusion previews to show known matching pages and published Listings, so that I can understand the impact before confirming.
26. As an Operator, I want an explicit indication when no known pages match a rule, so that the preview does not imply exhaustive coverage.
27. As an Operator, I want newly excluded unpublished candidates blocked immediately, so that in-flight work respects the restriction.
28. As an Operator, I want published Listings withdrawn separately from adding an exclusion, so that extraction limitations do not erase valid published information.
29. As an Operator, I want removal of an exclusion to allow future extraction without publishing old results, so that eligibility changes are predictable.
30. As an Operator, I want valid rental pages with extraction errors to remain visible exceptions, so that excluding difficult samples cannot disguise profile weaknesses.
31. As a Source Representative, I want Contact review team on my source screen and in the Message Center, so that I can discuss website problems in context.
32. As an Operator, I want to message a representative without changing source state, so that discussion does not accidentally pause or reject their Source.
33. As an Operator, I want Request changes and Reject to remain separate pending-proposal decisions with reasons, so that the representative understands required action or refusal.
34. As a Source Representative, I want to receive replies and decisions as notifications, so that I know when the review team needs my attention.
35. As an Operator, I want one responsible colleague per Source, so that messages and exceptions have a clear recipient.
36. As a queue manager, I want to reassign source responsibility with history preserved, so that work does not depend permanently on its original approver.
37. As an Operator, I want source decisions to enforce capabilities, responsibility, and independent review, so that taking over a case does not weaken authorization.
38. As an Operator, I want to pause a Source without revoking its assignment, so that I can temporarily stop extraction and unfinished publication.
39. As an Operator, I want existing Listings to retain normal availability while paused, so that pausing is not an implicit withdrawal.
40. As an Operator, I want explicit resume to start fresh extraction with current rules, so that stale unfinished work does not publish after recovery.
41. As an Operator, I want one current exception per Source URL with first occurrence and latest attempt, so that repeated runs do not multiply review work.
42. As an Operator, I want exceptions grouped by problem with bulk actions, so that I can address a common layout or missing-field problem efficiently.
43. As an Operator, I want valid candidates to continue according to publication mode despite other failures, so that one broken page does not disable the Source.
44. As a Source Representative, I want to inspect affected pages, fix my website, and request re-extraction, so that a fix can improve future runs as well as the current result.
45. As a Source Representative, I want to explain correct values in the Source Conversation, so that an Operator can help without giving me direct editing of extracted facts.
46. As an Operator, I want to correct a candidate without marking its extraction rule fixed, so that manual publication work does not hide recurring problems.
47. As an Operator, I want fresh successful extraction to resolve an exception independently of publication, so that waiting approval is not confused with extraction failure.
48. As an Operator, I want recurring failures to reopen the same exception with history, so that regressions remain understandable.
49. As an Operator, I want excluded pages labeled Excluded rather than successfully extracted, so that reporting remains honest.
50. As an Operator, I want changed exceptions summarized daily and unchanged repeats suppressed, so that notifications stay actionable.
51. As an Operator, I want an immediate alert when attempted non-excluded pages produce no usable results, so that complete extraction failure is visible without automatic source-wide pausing.
52. As a Source Representative, I want technical action requests to come explicitly from the Operator, so that extractor defects are not automatically presented as faults in my website.
53. As an Operator, I want superseded results retained in history and replaced by fresh review items, so that profile changes do not leave obsolete work as the current queue.

## Implementation Decisions

- Extend the existing Source Proposal, Source Profile, Source Assignment, Extraction Request/Run,
  candidate-publication, and communications modules. Prefer their existing workflow boundaries to a
  separate parallel extraction system. Extend the API contract and regenerate its client artifacts.
- Preserve URL approval before outbound discovery, hardened fetching, independent-review checks,
  bounded extraction, explicit LLM invocation, and explicit approval before applying profile changes.
  This refines the existing human-gate decision rather than removing it.
- Separate rule safety/executability, evidence sufficiency, field-quality findings, and human approval
  eligibility. Field conflicts, missing values, and insufficient sample counts must not be converted
  into hard profile approval failures. Candidate publication validation remains mandatory.
- Use available usable pages to propose a profile. Training and held-out sets must be disjoint; show
  actual counts. A single usable page can produce a draft with no independent validation. With no
  usable pages, present a request for a better example URL or website changes rather than an
  evidence-free approval path. Do not invent a statistical accuracy guarantee from sample results.
- Preserve individual sample failures and limited-evidence indicators. Approval despite limitations
  requires explicit acknowledgement and a recorded reason. Either publication mode remains available.
- Technically valid manual/LLM changes create immutable draft versions. A field-quality failure must
  not discard a valid LLM proposal. Record failures for malformed/unsafe output without producing an
  approvable version. Display changed fields, improvements, regressions, and affected pages.
- Keep automation authorization per Source and approved profile version. A newly approved version
  requires explicit publication-mode selection; trust is not an account-wide property.
- Make publication-mode changes explicit recorded actions rather than rewriting historical approval
  evidence. Enabling automatic publication affects only newly requested runs; previously pending
  results require explicit approval. Disabling it prevents further automatic publication from queued
  and running work. Recheck current restrictions at publication time.
- In approval-required mode, all candidates remain unpublished until approval. Bulk approval only
  includes candidates satisfying mandatory checks and current source restrictions. Correcting a
  candidate does not bypass those checks or erase its original evidence.
- Enforce one current website per Submitter across open proposals and active assignments, including
  concurrent requests. Rejected/discarded proposals do not occupy the slot. Replacing an active
  assignment requires ending it first and preserving existing revocation/withdrawal consequences.
  Preserve historical cases; do not silently revoke existing data while migrating this rule.
- Store Source Exclusions as enforced, separately auditable restrictions, not merely the existing
  discovery exclusion evidence. Support exact normalized URLs including meaningful query parameters,
  and path-section prefixes on the assigned website. A prefix for archive must not match archive-old.
- Require a reason and confirmation with a preview of known matching pages and affected published
  Listings; explicitly state when there are no known matches. Confirmation applies the restriction
  without another profile approval. Newly excluded unpublished candidates cannot publish, including
  those produced by in-flight work. Removing an exclusion only enables future processing.
- Withdrawing already-published Listings is a separate explicit action. Skipped pages retain exclusion
  reasons. A valid page with extraction failure remains an exception unless deliberately outside the
  supported scope; failure alone must not create an exclusion or remove validation evidence.
- Add a distinct replyable Source Conversation attached to the Source Proposal, preserving the
  Message Center's separation of communication purposes. Do not turn System Notifications into
  conversations or reuse Listing Inquiry participation rules. Expose it from both source detail and
  Message Center; preserve history when responsibility changes.
- Source Conversation messages do not change approval, publication mode, or pause state. Request
  changes and Reject remain explicit pending-proposal decisions with reasons. Messaging remains
  available after approval. Preserve existing privacy/redaction controls and domain-purpose retention;
  do not introduce user deletion/archive controls as part of this feature.
- Give each Source one responsible Operator, initially its approver. Authorized queue managers can
  reassign it with history. Decision authorization follows current responsibility and relevant
  capabilities, rather than permanently requiring the original approver. Independent review remains
  mandatory. Conversation access must be restricted to its representative and authorized operational
  participants; notification delivery follows current responsibility.
- Add explicit source pause/resume state separate from assignment revocation. Pause stops new
  extraction and prevents unfinished publication, including explicit approval while paused. Published
  Listings retain ordinary availability/expiry behavior. Resume requires an Operator action.
- Resume or approval of a different profile starts fresh extraction with the current approved profile
  and exclusions. Old unfinished results never automatically publish, remain in history, and cease
  being the current review work as fresh results for their URLs arrive. Prevent stale worker completion
  from overriding newer outcomes; preserve retry and concurrency protections.
- Maintain one current extraction exception per Source and canonical URL, with first occurrence,
  latest problem, last attempt, and history. Group by problem and support bulk actions within the same
  authorization and validation rules as individual actions. Repeated runs update current exceptions
  instead of generating duplicate work.
- Fresh extraction passing candidate checks resolves the extraction exception, not necessarily
  publication approval. Later failure reopens it with history. Exclusion is a separate visible outcome.
  Manual candidate correction clears that candidate's blocker without declaring the source rule fixed.
- Representatives can inspect affected pages, fix the source website, request re-extraction, and
  explain corrections through Source Conversation. They cannot directly edit extracted facts in this
  initial implementation. Operators retain candidate correction capability.
- Deliver messages, review decisions, pause/resume, and mode-change notifications immediately.
  Deliver at most one daily source exception summary when new/resolved/reopened exceptions exist;
  unchanged repeats do not notify. Alert the responsible Operator immediately when a run attempts
  non-excluded pages but yields no usable results, suppressing repeats until recovery. Excluded-only
  runs must not trigger that alert. Failures alone do not automatically pause the Source.
- Representatives receive technical exception notifications only when an Operator explicitly requests
  action; affected pages remain visible to them. Source detail always shows current state, publication
  mode, run history, exclusions, and exceptions, independently of notification delivery.
- Daily notification delivery may use the existing background-task mechanism. Recurring extraction
  configuration is not part of this feature; all restrictions must remain applicable when it is added.

## Testing Decisions

- Prefer the existing API-to-database workflow boundary as the primary acceptance seam. Exercise
  authenticated requests, task execution, observable API responses, persisted history, notifications,
  and catalog publication. Test external behavior rather than private function layout or call counts.
- Use PostgreSQL for database-specific constraints and concurrent transitions. Stub network fetching
  and model responses at the existing external boundaries with deterministic fixtures; ordinary tests
  must not require live websites or paid model calls.
- Prior art includes the existing source profile workflow/repair, discovery, assignment/revocation,
  extraction request/publication/automatic, and source notification tests. Extend those scenarios
  rather than introduce a new test-only service architecture.
- Cover one-, three-, and ten-page profiles; no usable page; disjoint training/validation membership;
  honest limited-evidence presentation; imperfect-profile approval in both modes; unsafe-rule refusal.
- Cover an LLM repair that improves selected fields while unrelated fields fail: retain the draft,
  compare its evidence, leave the active version unchanged, and require explicit approval. Also test
  malformed output, expired authorization, and stale profile/review revision responses.
- Cover mixed valid/conflicting/missing/drift candidates. Verify only eligible candidates publish in
  automatic mode, none publish without approval in supervised mode, and bulk approval cannot bypass
  candidate checks, source exclusions, pause state, or independent review.
- Exercise enabling automation without draining a backlog, disabling it during queued/running work,
  pause during completion, explicit resume, and profile replacement. Assert no stale publication and
  no unintended withdrawal of existing Listings.
- Cover exact URL and path-section exclusions, meaningful query parameters, similar prefix names,
  cross-host rejection, no-known-match previews, affected published Listings, in-flight publication
  blocking, explicit withdrawal, and removal without automatic backlog publication.
- Cover concurrent introduction attempts, resuming an existing case, rejected/discarded slot release,
  active assignment replacement, and retained history under the one-current-website rule.
- Cover source responsibility reassignment, loss of permissions, own-work refusal, representative
  isolation, conversation replies and notifications, and the fact that messaging alone never changes
  extraction or approval state.
- Cover exception deduplication, grouping, automatic resolution, reopening, Excluded outcomes,
  candidate-only corrections, and stale completion versus newer results. Assert no duplicate current
  review work across retries or repeated runs.
- Use a controlled clock for daily summaries and no-usable-result alerts. Assert unchanged-repeat
  suppression, recovery/re-alert behavior, excluded-only runs, current-operator routing, and no
  unsolicited technical notification to the representative.
- Use focused React/Testing Library tests with mocked API responses for profile evidence and repair
  comparisons, mode switching, previews, grouped bulk actions, source status, and Source Conversation
  navigation. Prior art includes the operator Source Proposal, submitter Source Proposal/dashboard,
  and Message Center tests.
- Reserve Playwright for behavior requiring a real browser; do not duplicate API and React coverage.
  Check accessible action labels, loading/conflict states, Persian copy, and responsive presentation.
- Run the repository's required lint, formatting, type, API drift, build, and relevant test checks during
  implementation. Preserve the backend coverage requirement and provide UI screenshots for the PR.

## Out of Scope

- Recurring extraction schedule configuration, frequency, scheduled starting URLs, and fetch budgets.
- Automatic LLM invocation, automatic profile activation, or a replacement discovery/scraping engine.
- Direct representative editing of extracted facts, account-wide trust, or multiple current websites.
- Automatically classifying extraction failures as invalid pages or silently excluding them.
- Automatic publication of old backlogs when enabling automation, resuming, or removing exclusions.
- Implicit withdrawal when pausing, messaging, changing mode, or adding exclusions.
- New domain-ownership verification or changes to the existing meaning of Source Assignment.
- A generic conversation platform, user-controlled conversation deletion/archive, or relaxation of
  existing fetching, privacy, and independent-review boundaries.

## Further Notes

This specification synthesizes the agreed design discussion. Existing behavior is narrower: initial
profile creation requires ten supported pages, field validation gates approval and successful LLM
repair retention, stored exclusions are evidence rather than enforced ignore rules, review reasons
are non-replyable notifications, and extraction requests are representative-triggered.

The main trade-off is deliberate: evidence informs human authorization without guaranteeing factual
accuracy, while mandatory per-candidate checks contain detectable failures. Trust applies to the
specific Source and approved profile version. Keep limited evidence and failures visible so flexibility
does not become a misleading claim of validation success.

The existing decisions on human-gated fetching/profile changes, exclusive Source Assignments, and
separate communication purposes remain applicable. The accompanying decision on separating profile
quality from publication authorization records this change in policy. Implementation should ship
migrations and contract/client updates together, preserving historical approval and review evidence.
