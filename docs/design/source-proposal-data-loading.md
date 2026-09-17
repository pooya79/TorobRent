# Source Proposal data loading and replacement

Status: loading, replacement, and approve/reject-only review changes implemented.
Full validation was stopped at the user’s request; the one-off development cleanup remains pending.

## Agreed decisions

- The Operator queue returns compact identity, responsibility, workflow, count, and warning
  summaries.
- Opening a Source Proposal loads its overview. Other sections fetch their data when selected;
  direct links load the targeted section. Candidate evidence loads when that candidate is opened.
- Results and history use server-side pagination with 20 items per page. Search and filtering run
  on the server before pagination, so opening a tab does not download its entire collection.
- Automatic refresh targets compact progress and responsibility information. Review data refreshes
  after actions, on returning to the page, or explicitly; historical evidence is not polled.
- New extracted data replaces older extracted data instead of accumulating historical payloads.
  Hiding old payloads in API responses alone does not satisfy this retention decision.
- Replacement happens per listing URL after successful extraction. A failed attempt retains the
  last successful result and exposes the latest failure. Unvisited URLs remain untouched.
- Compact run summaries and Operator decisions remain available after obsolete extraction values,
  evidence, and unused media are removed. Published Listings and approved Source Profile definitions
  are separate from disposable extraction payloads. See [ADR-0019](../adr/0019-replace-obsolete-extraction-payloads.md).
- Existing accumulated development data is cleaned up with one explicitly run, one-off command.
  This initial cleanup does not require a committed migration, cleanup job, or maintenance command,
  because the application is not yet in production. It follows the same retention rules and preserves
  published Listings and their media. Normal extraction still implements replacement of obsolete
  payloads as new successful results arrive, preventing accumulation from recurring.

## Execution boundary

The user requested committing the current changes before completing validation and the one-off
development cleanup. Existing stored payloads have not been cleaned up.

## Listing review

- Operators approve or reject extracted listings; they cannot edit extracted values or images,
  or request changes to an individual extracted candidate. Existing correction history remains readable.
- Fresh extraction supplies replacement values without carrying manual corrections forward.
- Superseded candidates and stale revisions cannot be approved from an outdated review.
- The correction capability removal, section reads, pagination, and future payload replacement are implemented.

## Measured motivation

Local diagnosis found a queue response of approximately 54.8 MB for two proposals. Recent extraction
requests contributed 52.9 MB, including 1,815 candidates across 302 distinct URLs. Candidate evidence
accounted for approximately 45.7 MB and source claims for 4.5 MB. A heavy case response was 62.8 MB.

The existing code shares a nested representation across the queue and case detail, includes full
candidates inside recent runs, and polls every five seconds. Frontend pagination and hidden tabs
do not bound the response or defer rendering their children.
