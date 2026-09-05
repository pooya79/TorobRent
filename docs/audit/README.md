# Product journey audit

Started: 2026-09-05. Baseline: `60ab4d4d54e9cb32b634578ccb93366f1e53d8d0`.

## Resume here

Active journey: **J01 — Discover rentals**, status **discussing**.
Open decision: [J01-D01: default category](journeys/J01-discover-rentals.md#open-decision).
No journey acceptance criteria have yet been agreed with the user. No product corrections have
been implemented. Only the initial J01 browser walkthrough has been performed.

The user requested an audit because agent-written features have not received their product review.
Code, tests, glossary, ADRs, and public copy describe existing behavior or earlier intent; none is
evidence that the user accepts that behavior. Recommendations stay provisional until answered.

## Inventory and recommended order

This is a route, workflow, and test inventory, not a claim that every implementation is correct.
Order weighs renter value, harm from incorrect behavior, exposure, and dependencies. Start with
discovery and comparison to establish what the service promises, then contact/privacy and access,
then publication and automated supply, then supporting workflows. A confirmed serious privacy or
authorization defect takes precedence over this order.

All rows except J01 are **inventoried; not yet discussed or verified**. Split a row into smaller
journeys when its decisions are too broad; retain its ID as the parent.

| ID | Journey and actor outcome | Entry / implementation evidence | Risk and questions to examine |
| --- | --- | --- | --- |
| J01 | Renter discovers relevant rentals without an account | `/`, `/search`; `frontend/src/pages/{HomePage,ResultsPage}.tsx`; `backend/apps/catalog/selectors.py`; `frontend/tests/ResultsPage.test.tsx`, `backend/tests/test_catalog.py` | Core/high: default market and category, filters, complete Rental Terms pairs, sorting, duplicates, paging, URL/back behavior, empty/error states |
| J02 | Renter inspects a Property and compares its Listings | `/properties/:propertyId/:slug?`; `frontend/src/pages/PropertyDetailPage.tsx`; `backend/apps/catalog/views.py`; `frontend/tests/PropertyDetailPage.test.tsx` | Core/high: conflicting source claims, freshness, inactive/deleted/merged links, image provenance, exact-location privacy |
| J03 | Renter explores an area on the map | J01 map; `frontend/src/features/map/`; catalog viewport selectors; `frontend/tests/{SearchMapPanel,MapAdapter,MapViewConstraints}.test.*` | High: location disclosure, moving map changes results, missing coordinates, clusters, map failure, mobile and keyboard access |
| J04 | Renter reveals a Direct Listing phone or continues to an external Source | Property detail; catalog `ListingPhoneRevealView`, `ListingContinuationView`; `backend/tests/test_catalog.py` | High: authentication boundary, contact consent, blocking, stale availability, link safety, event recording |
| J05 | Account holder registers, verifies, logs in, recovers access and signs out | `/register`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`; `backend/apps/accounts/{services,session_urls}.py`; `backend/tests/test_accounts.py` | Critical: identity ownership, email/phone rules, duplicate accounts, OTP expiry/rate limits, recovery, return destination, expired sessions |
| J06 | Renter and Submitter privately discuss one Listing | `/messages`; `backend/apps/communications/services.py`; `backend/tests/test_listing_inquiries.py` | Critical: eligible recipient, display names, Listing boundary, quotas, edit windows, unavailable Listings, cross-account access |
| J07 | Participant blocks/reports abuse; moderator investigates | Message detail, `/operator/conversation-reports`; `backend/tests/test_conversation_reports.py`; `frontend/tests/OperatorConversationReportsPage.test.tsx` | Critical: account-pair block scope, report-only private inspection, evidence, moderator authority, report outcomes |
| J08 | Account holder becomes an Owner, Agent, or Source Representative | `/advertise`, `/submitter/get-started`; `frontend/src/pages/SubmitterOnboardingPage.tsx`; account onboarding service | High: asserted authority versus verified identity, phone requirement, switching paths, existing accounts |
| J09 | Owner/Agent drafts and submits rental information | `/add-submission`, `/dashboard`; `backend/apps/submissions/services.py`; `backend/tests/{test_submissions,test_media}.py` | Core/high: required facts, toman entry, alternate contact verification and publication consent, exact location, media, draft resume/discard, changes requested |
| J10 | Operator reviews a Submission and publishes or refuses it | `/operator/submissions`; Submission claim/decision services; `backend/tests/test_submission_review.py` | Critical: no self-review, claims and stale decisions, normalization, Property matching, rejection reasons, Submitter-visible outcome |
| J11 | Submitter maintains availability and edits/withdraws published rental information | `/dashboard`; submission availability endpoints, catalog services/tasks; `backend/tests/test_listing_availability.py` | High: reconfirmation versus changed terms, expiry timing, old version during review, notifications and retries |
| J12 | Catalog Operator corrects, groups, splits and maintains published Properties/Listings | `/operator/links`, catalog/admin and catalog services; `backend/tests/test_catalog.py` | Critical: mistaken merge, preserved source claims and Favorites, restricted coordinates, link verification and history; verify actual admin/workspace coverage |
| J13 | Source Representative proposes a Source; Operator approves/revokes assignment | `/source-proposal`, `/operator/source-proposals`; `backend/apps/source_proposals/{services,assignments}.py`; `backend/tests/{test_source_proposal_review,test_source_assignments,test_source_revocation}.py` | Critical: authority assertion, exclusive domain assignment, URL approval before fetch, reassignment and bulk withdrawal |
| J14 | Operator discovers source structure and approves/repairs extraction rules | Source Proposal workspace; `discovery_workflow.py`, `profiles.py`, `profile_repair.py`; `backend/tests/{test_source_profile_workflow,test_source_profile_repair}.py` | Critical: real network access, evidence quality, held-out validation, manual/LLM edits, cost and explicit approval, drift |
| J15 | Representative requests extraction; Operator handles exceptions and publication | Source dashboard/workspace; `extraction.py`, `run_review.py`, `candidate_publication.py`; `backend/tests/{test_extraction_requests,test_extraction_publication,test_extraction_automatic}.py` | Critical: automatic versus per-run approval, invalid facts, deduplication, retries, stale runs, publishing scope, availability |
| J16 | Operator reviews source images; renters see appropriate retained media | Source candidate UI; `external_media.py`, `media_retention.py`; `backend/tests/test_external_media.py` | High: allowed hosts, image privacy/provenance, source versus Property images, late jobs, withdrawal and retention |
| J17 | Renter saves and revisits Favorites | `/favorites`, card/detail/map controls; catalog favorite selectors; `backend/tests/test_favorites.py`, `frontend/tests/FavoritesPage.test.tsx` | Medium: login continuation, rollback, unavailable Properties, merges and removal |
| J18 | Account holder follows notifications and unread communication | `/messages`, `/messages/:messageId`; `frontend/src/pages/MessageCenterPage.tsx`; `backend/tests/{test_message_center,test_submission_notifications,test_source_proposal_notifications}.py` | Medium/high: mixed record types, unread/read behavior, recipient privacy, deep links and obsolete objects |
| J19 | Account holder requests help; Operator triages, replies, escalates and resolves | `/contact`, `/messages/new/support`, `/operator/support`; `backend/apps/contact/services.py`; `backend/tests/{test_support_requests,test_support_resolution,test_support_messages}.py` | High: identity/privacy routing, internal versus public content, assignment, reopening, external contact logs |
| J20 | Administrator grants operational access and performs privacy/break-glass actions | `/admin`, `/operator`; account/admin services, support redaction; `docs/operator-parity.md`; `backend/tests/{test_operator_capabilities,test_communication_retention}.py` | Critical, privileged: least authority, self-work, anonymization, retained history, irreversible redaction/deletion, audit trail |
| J21 | Visitor understands the service, limits, guidance and policies | `/about`, `/guide`, `/privacy`, `/terms`, homepage/footer; `frontend/src/pages/PublicGuidancePages.tsx`; `frontend/tests/PublicGuidancePages.test.tsx` | Medium/high: claims versus actual guarantees, alpha limits, geographic coverage, dead links and contact routes; inspect applicable copy during every earlier journey |

Evidence roots are repository-relative. Relevant historical decisions are in `docs/adr/0001`–`0015`
and vocabulary in `CONTEXT.md`. The API surface is indexed by `frontend/src/routes.ts`, app URL
modules, and `contracts/openapi.yaml`. These paths make the inventory resumable without treating
the test names or earlier decisions as accepted requirements.

## Checklist for every journey

Copy this checklist into its journey record and update each item with evidence or an explicit
not-applicable reason. Status sequence: inventoried → discussing → criteria agreed → correcting →
reviewing → verifying → complete. Findings use observed / suspected / confirmed / fixed / verified /
explicitly deferred. A passing pre-existing test alone never closes a product finding.

- [ ] Identify actor, purpose, start, successful end, preconditions and scope boundaries.
- [ ] Read relevant glossary, ADRs, UI, API, services/selectors, jobs and existing tests.
- [ ] Explain the current happy path in plain language, separating code inference from observation.
- [ ] Walk the running UI with representative data; record environment, role, actions and results.
- [ ] Inspect alternate/empty/error paths, validation, refresh/back/deep links and interrupted work.
- [ ] Inspect applicable permissions, privacy, concurrency, retries, time/expiry and external failures.
- [ ] Inspect applicable mobile, keyboard/focus, RTL/Persian copy, numeric units and accessibility.
- [ ] Ask one product decision at a time, with a recommendation and concrete edge-case scenario.
- [ ] Record the user's answer immediately; distinguish proposed from agreed acceptance criteria.
- [ ] Update resolved vocabulary in `CONTEXT.md`; keep criteria and findings here. Revisit ADRs only
      for agreed consequential trade-offs, and explicitly identify any conflict with an existing ADR.
- [ ] Settle scope and remaining decisions; implement corrections against agreed criterion IDs.
- [ ] Review the diff against each criterion, permissions and repository standards; record findings.
- [ ] Run focused meaningful tests plus required repository checks appropriate to the changes.
- [ ] Re-walk the corrected journey in the running UI; record actual versus expected outcomes and
      capture screenshots for UI changes. Use PostgreSQL for database-specific behavior.
- [ ] Close each finding with evidence or explicit user deferral. Record remaining limits, update
      this index and only then move to the next journey.

Each journey record contains: current behavior and evidence; decisions; agreed criteria with
stable IDs; findings with reproduction/impact; implementation-to-criterion mapping; diff review;
verification commands/results; deferred items; next decision. Never pre-check unperformed steps.

## Initial cross-cutting findings

| ID | Status | Evidence and impact | Follow-up |
| --- | --- | --- | --- |
| A-F01 | Observed documentation drift | `docs/architecture.md` says the application deliberately has no product domain; the repository now contains catalog, submissions, communication and source workflows. | Correct architecture description after scope review; do not use this sentence as product intent. |
| A-F02 | Suspected promise mismatch | Homepage says every Property's information receives Operator review before publication; ADR-0014 allows approved-profile automatic publication of valid results. | J10/J14/J15/J21: trace publication guarantees and settle precise public wording. No policy selected yet. |

## Audit environment

Initial working tree was clean. The documented UI was offline; PostgreSQL and Redis were running.
Existing development database had pending migrations. Created separate local PostgreSQL database
`torobrent_product_audit_20260905`, migrated it, and ran the repository `seed_dev` command (60
Properties, 80 Listings). Existing development data was not migrated or reseeded.

Frontend: `pnpm dev --host 127.0.0.1` in `frontend` on port 5173. Backend: local Django settings,
`DATABASE_URL=postgresql://app:app@localhost:5432/torobrent_product_audit_20260905`, Uvicorn bound to
127.0.0.1:8000. These are local development defaults, not production credentials. Map rendered via
OpenStreetMap. No source extraction or external messaging was initiated. Background worker/beat
were not started; asynchronous workflows remain unverified. Sample data is not market evidence.

Before resuming, check the current revision, working tree, running servers and database selection;
refresh observations when their implementation has changed. Do not rerun the seed over an active
audit scenario without considering its state.
