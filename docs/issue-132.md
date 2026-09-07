# Explicit preference ranking (#132)

Search accepts `ordering=preference_fit` and a bounded `preferences` JSON query parameter.
Each controlled identifier maps to `{ "priority": "preferred", "target": ... }`.
Priorities are `very_important`, `preferred`, and `unimportant`. Targets are a Property Type,
up to 22 District or Neighborhood UUIDs, an explicit present/absent Feature State, or a bounded
integer (Floor Area in square meters, Bedroom Count, construction year in the Persian calendar,
Rental Terms in toman, freshness in days). Invalid entries are ignored independently and reported
as controlled identifiers in `ignored_preferences`. The original URL remains available for correction.

`explicit-v1` uses priority weights 3, 1, and 0. Categorical targets match exactly; location targets
match any selected area. Floor Area and Bedroom Count fall linearly with distance from the target,
reaching zero at a distance equal to the target (one for zero bedrooms). Construction year reaches
zero 30 years before the target. Lower-cost and freshness preferences are fully satisfied up to
the stated target, then decay as `(target + 1) / (actual + 1)`. Freshness uses calendar-day age
in UTC, captured once per request. Bands are high at 0.8, reasonable at 0.5, and weak below 0.5.
These are product constants, not a judgment of Property quality.

Unknown facts never enter the denominator. With no known applicable facts, the band is null and
a neutral 0.5 ordering position is used; the UI explains insufficient information. Satisfied
components have fit at least 0.8. Remaining components are trade-offs ordered by weighted shortfall,
so the largest compromise appears first. Internal scores are not exposed to presentation code.

Hard filters first determine eligible Properties and complete eligible Rental Terms pairs.
The catalog evaluates all eligible Active Listings per Property, choosing the strongest fit,
then freshest Availability Confirmation and stable Listing identity. Property ties use that
confirmation and Property identity. The existing Active Listing count remains independent of
budget eligibility. No Property Detail code or response behavior changes.

Ranking materializes the full eligible catalog and batches Listing retrieval before pagination.
The list and map reuse the same assessed objects. Query count remains bounded (six or fewer for
unfiltered representative search), while memory and scoring time grow with eligible inventory.
For a much larger catalog, move the same versioned behavior behind database expressions or a
batch ranking backend; do not rank only a page of results.

The responsive Sheet preserves hard filters and configured preferences when ranking is turned
off. Its URL stores the canonical return order, restoring it on reset. Both map providers use
size, fill, outline, and text fit labels; cards disclose all evidence through a keyboard-accessible
summary. No analytics events or personal preference persistence were added.

Validation includes HTTP ranking contracts on PostgreSQL, bounded query counts, list/map evidence
parity, priority application/reset, disclosure, malformed-state correction, focus restoration,
and the existing Chromium browser contract. Desktop marker and mobile Sheet captures are in
`docs/screenshots/issue-132-*.png`. Independent Standards and Spec reviews found no outstanding
issues after shared marker appearance extraction and handling Listings expiring between queries.

Final checks: full suite passed (819 backend tests, 93.02% coverage; 339 frontend tests),
22 focused ranking regressions passed separately, Chromium contract passed all 9 tests,
and lint, formatting, typechecking, API drift, and production build passed. The map providers'
accessible marker names include fit bands. Mobile results controls wrap instead of clipping.
