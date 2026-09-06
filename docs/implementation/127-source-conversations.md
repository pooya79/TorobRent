# Source Conversations — issue #127

Implemented for [issue #127](https://github.com/pooya79/TorobRent/issues/127).

Each submitted Source Proposal has one independently retained Source Conversation. Representatives
and the current responsible Source Operator can open it from source detail or Message Center.
Before responsibility is assigned, an active Review Claim routes the conversation to its holder;
otherwise eligible Source reviewers can handle it. Reassignment transfers access and unread work
without deleting correspondence. Correction drafts and approved proposals remain replyable.

Messages produce unread conversation items and the existing Message Center badge, independently of
non-replyable decision notifications. Sending a message does not decide, pause, extract, or publish.
Operator identity is presented as the review team. Support, privacy, queue-management, and Listing
Inquiry moderation capabilities alone do not grant correspondence access. Deleted representatives
leave readable operational history. Superuser-only message redaction records its actor and time;
there are no user deletion, archive, or edit endpoints.

The change includes migration `communications.0011`, regenerated OpenAPI/client artifacts, and
navigation to historical source cases through the operator source-context query.

## Validation

- Full PostgreSQL backend suite: **739 passed**, **92.74% coverage**.
- The subsequently added correction-draft regression also passed on PostgreSQL.
- Focused Message Center, source navigation, representative source, and operator source React suites:
  **56 passed**.
- Ruff, frontend lint/style/assets, formatting, mypy, TypeScript, API regeneration/drift/lint, and
  production build passed.
- Full React suite: **304 passed, 16 failed**. The same 16 failures were reproduced against starting
  commit `8d5282ece0c750b2dde45998dcf5432d26902e74` in an isolated checkout. They are existing
  expectations in `OperatorOverviewPage`, `OperatorReviewPage`, `OperatorSupportPage`,
  `OperatorWorkspace`, and `ResultsPage`; consequently `make check` is not green.

## Standards review

No documented-standard violations. The review identified duplicated operator-source query setup;
this was consolidated into one parameterized query factory. The existing per-kind Message Center
serializer branching remains a non-blocking design observation, consistent with the surrounding
implementation.

## Spec review

One issue was found and fixed: requesting corrections returns a submitted proposal to draft on its
first edit. Conversation access and source navigation now remain available for these later draft
revisions, with API and React regressions. No other concrete spec violations or scope creep found.

## Screenshots

Captured in Chromium with deterministic fictional API fixtures, including server-rendered account
state; no development accounts or source data were changed. Desktop and mobile screenshots were
visually checked.

- [Conversation, desktop](../design/screenshots/issue-127/conversation-desktop.png)
- [Conversation, mobile](../design/screenshots/issue-127/conversation-mobile.png)
- [Start from Message Center](../design/screenshots/issue-127/message-center-start.png)
- [Contact from source detail](../design/screenshots/issue-127/source-detail.png)
