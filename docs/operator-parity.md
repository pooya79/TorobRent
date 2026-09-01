# Operator workflow parity and break-glass operations

The React Operator Workspace is the routine interface for Submission Review and Support Requests.
The parity gate for these workflows is satisfied only while the checks below remain green.

## Parity gate

- The capability contract, route guards, domain APIs, self-work rules, stale-write handling, and
  domain-owned immutable histories are covered by focused backend and React tests.
- The browser contract covers login return navigation into the Operator Workspace. Focused backend
  and React tests cover capability-filtered access, Submission claiming and publication,
  Submitter-visible outcomes, Support Request routing and finalization, and compatibility routes.
- Submission and Support queues poll every 30 seconds while open and invalidate both queue and
  selected-record queries immediately after mutations. No WebSockets, push notifications, or
  Operator email alerts are part of this release.
- The overview calls each accessible domain's summary endpoint in parallel. Summary counts use the
  same authorization and self-work selectors as queues. Work becomes an aging warning after 48
  hours.
- Existing Support Requests and pending Submissions are preserved by migration and focused workflow
  tests.
- Desktop and tablet are fully supported. Mobile supports overview, queue triage, claiming, and
  simple actions; dense Submission normalization remains a desktop/tablet workflow.

If any item fails, treat React parity as lost and restore it before removing another fallback.

## Django admin boundary

Ordinary Support handling is no longer available in Django admin. Only superusers can inspect the
read-only Support Request admin, use the explicit personal-content redaction action, or perform a
break-glass repair. Routine classification, assignment, notes, escalation, and resolution belong in
React and its domain services.

Django admin remains the permanent interface for user, group, capability, and permission
provisioning; technical configuration; account anonymization; destructive privacy actions; and
audited break-glass repair. Submission decision repair appends a `SubmissionEvent` correction and
never edits the original decision. A break-glass operator must record the incident and reason in
the appended domain event.

## Privacy operations

Account anonymization deactivates the account, removes its credentials, name, email identity, and
Operator grants, and retains only its UUID as an opaque stable historical actor reference. History
APIs display `Former Operator` after anonymization and do not return the former email.

Support personal-content redaction replaces requester identity, request and resolution text, note
bodies, and the personal summaries attached to external contacts, identity verifications, and
privacy actions. It preserves the operational facts: actors, timestamps, state, classification,
assignment, routing and reasons, contact outcomes, resolution categories, verification methods,
privacy-action types, and correction links. The redaction itself appends a domain event. These
actions are deliberately separate: anonymizing an account does not silently rewrite a Support
Request, and redacting a Support Request does not erase its operational history.

Exact retention periods for account fields, Support content, immutable events, and backups remain
deferred to a dedicated privacy and compliance review. No retention duration should be inferred
from this rollout.
