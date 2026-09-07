# Source exception notifications (#130)

Extraction completion retains notification state under the same Source lock as current page
outcomes and responsibility changes. New, resolved, and reopened page exceptions accumulate until
the next summary delivery; repeated unchanged failures and stale page completions add nothing.
Exclusion stays a separate outcome. Historical records are not replayed into notifications.

Celery Beat checks pending delivery every five minutes, processing at most 200 Sources, with
never-checked Sources first and then least-recently checked Sources. It creates at most one summary
per Source per UTC calendar date (the configured application timezone). Changes after today's
summary remain pending for the next day. Counters count transitions: a page that resolves and
reopens before delivery contributes to both categories. Source screens always read current page
state independently of notification delivery.

A run that attempts non-excluded pages and produces no usable results immediately creates one
private Operator notification. Usable results mean fresh candidates passing mandatory checks and
not held by an exclusion, or explicit unavailability evidence. Excluded-only runs neither alert nor
claim recovery. The next usable run rearms the alert for a later regression. Request ordering and
attempt numbers fence stale completions; task redelivery cannot duplicate a notice. These failures
never pause processing or request representative action.

Delivery rereads the active Assignment and current responsible Operator, including capability,
active account, verified email, and independent responsibility. If no eligible recipient exists,
changes and an ongoing undelivered failure remain pending for the periodic delivery task. Recovery
clears an undelivered failure. Reassignment does not replay notices already delivered. A retained
notice loses its navigation link when its recipient no longer has current authority. Notification
content contains counts and generic explanations, with no page evidence or transport details.

Representatives retain affected-page inspection and extraction requests. Technical action requests
use an explicit Operator message in Source Conversation. Existing message, review-decision,
pause/resume, and publication-mode notifications retain their immediate behavior.

## Deployment

Apply source-proposal migrations 0036–0038 and communications migration 0012 before starting new
application and Celery workers. New attempt/result counters are nullable so historical runs show
“ثبت نشده” rather than invented zeros. No historical outcomes, approvals, or conversations are
rewritten. Drain old workers during rollout; they do not record notification state. Run one Celery
Beat scheduler with the existing workers. This schedule delivers notifications only; it does not
configure recurring extraction.

## Validation

API/task/PostgreSQL tests cover daily aggregation, recovery, excluded-only runs and redirects,
transient retries, duplicate concurrent delivery, current responsibility, capability loss, private
navigation, and delivery fairness. Focused React tests cover Source guidance and non-replyable
notification navigation. Screenshots use deterministic local fixtures and the actual components.

- [Operator exception and run counts](screenshots/issue-130-operator.png)
- [Representative page inspection](screenshots/issue-130-representative.png)
- [Mobile Source screen](screenshots/issue-130-mobile.png)
- [Message Center summary and destination](screenshots/issue-130-notification.png)

## Standards review

No remaining findings. The initial review found PostgreSQL null ordering could starve unchecked
Sources behind 200 ineligible recipients. Explicit nulls-first ordering fixes this; the PostgreSQL
regression failed before the fix and passed afterward.

## Spec review

No remaining findings. The initial review found that a redirect into an excluded destination could
count the original URL as a failed attempt. Recording its excluded outcome against the requested
URL fixes the false alert; the regression failed before the fix and passed afterward.

Final validation: all 779 PostgreSQL backend tests pass with 92.95% coverage (minimum 85%). The
full frontend run passes 316 tests and has 16 pre-existing failures. The identical sixteen failures
were reproduced at starting commit `f97578e26fc30639e8bafbdad4a9c0c227bc79ef` in
OperatorOverviewPage, OperatorReviewPage, OperatorSupportPage, OperatorWorkspace, and ResultsPage.
All focused Source and Message Center tests pass. Lint, formatting, backend/frontend typechecking,
API regeneration/validation/drift, migration drift, and production build pass. The build ran from an
isolated copy because the checkout's pre-existing `frontend/build` directory belongs to `nobody`.
Desktop and mobile screenshot inspection found no horizontal overflow.
