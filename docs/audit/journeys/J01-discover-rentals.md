# J01 — Discover rentals

Status: **discussing**. Last updated: 2026-09-05.
Baseline and environment: [audit index](../README.md).

## Scope and current behavior

Actor: anonymous Renter. Start at the homepage; find a relevant Property and reach its detail link.
Detailed comparison, contact, Favorites and map semantics have their own journeys; capture boundary
findings here without silently expanding the agreed scope.

Current implementation, not agreed requirements:

1. The homepage offers a city and Property Type picker. Only Tehran is currently searchable;
   other displayed cities are marked coming soon. The type picker initially says “all properties.”
2. An unrestricted search opens with Residential selected. Commercial is a separate category;
   changing category changes the available types and quick filters.
3. Results represent Properties, grouping their active source Listings. Cards show normalized
   Property facts and a deposit/monthly-rent pair from one eligible Listing, plus the active count.
4. Both budget limits must match the same Listing. Sorting chooses which matching Listing supplies
   the displayed terms: default newest uses availability-confirmation time; rent/deposit sorts use
   that amount. Area sorting uses Property area and the freshest matching Listing's terms.
5. An active Listing is published, has a future availability deadline, and belongs to an active
   Source. Expired/unavailable Listings do not qualify a Property for search.
6. Filters include location, category/types, budget, area, construction year, Bedroom Count and
   explicit feature states. Unknown features are distinct from absent features. Public map filtering
   uses Approximate Location; it excludes unlocated Properties when viewport bounds apply.
7. Existing React tests describe staged advanced filters, quick filters, continuation/retry,
   URL/back restoration, map failure and responsive behavior. These cases have not been re-run or
   accepted as requirements in this audit.

## Evidence

- `frontend/src/pages/HomePage.tsx`: form defaults and public claims.
- `frontend/src/features/catalog/{queries,property-type-selection}.ts`: request/category rules.
- `frontend/src/pages/ResultsPage.tsx`, `frontend/src/features/catalog/CatalogFilters.tsx`: controls.
- `backend/apps/catalog/selectors.py`: `search_properties`, `SEARCH_ORDERING_SPECS`, facets.
- `backend/apps/catalog/models.py`: `ActiveListingQuerySet.active`.
- `backend/tests/test_catalog.py`: paired-budget, availability, grouping and ordering examples.
- `frontend/tests/{HomePage,ResultsPage}.test.tsx`: existing frontend behavior expectations.
- `CONTEXT.md`; ADR-0001 (Property/Listing), ADR-0002 (money), ADR-0006 (categories), ADR-0007
  (Approximate Location). Their intent remains open to user review.

## Browser observations

2026-09-05, anonymous, desktop 1280×720, local seeded PostgreSQL and OpenStreetMap:

| Action | Actual result | Scope of evidence |
| --- | --- | --- |
| Open `/` | Persian RTL homepage; all-properties picker; Tehran coverage with other cities coming soon | Initial UI rendered; not a complete homepage accessibility review |
| Submit default homepage search | Search showed Residential selected, 24 Properties, all 24 mapped | Default flow exposes a category narrower than the homepage picker label suggests |
| Inspect search screenshot | Dark desktop split: map left, result cards right; Property placeholders and active-Listing counts visible | Sample data had missing images; no conclusion about production media |
| Select Commercial | 30 Properties; quick filters changed to parking/elevator/storage; Bedroom Count controls disappeared | Category switching observed in real browser |
| Open Advanced Filters | Budget, area, construction year, explicit feature controls and all five sort options; newest selected | Controls inspected; applying/cancelling changes not yet exercised |
| Inspect browser error log | No errors in the inspected log sample | Does not establish absence of errors across all paths |

Not yet exercised: choosing explicit homepage types, filters, map movement, mobile/keyboard, no
results, offline/failed requests, pagination, back/refresh, time expiry or a corrected implementation.

## Open decision

**J01-D01 — What should an unspecified Property Category mean?**

Concrete scenario: a visitor leaves the homepage's “all properties” selector untouched and searches.
The current result selects Residential and omits Commercial inventory.

Recommendation: search both Residential and Commercial when no category was selected, with explicit
category controls for narrowing. This honors the broad label and does not silently discard intent.
Alternatives are a clearly labeled Residential default or requiring a category before searching.
The decision must also cover direct `/search` links with no category; explicit typed/category links
should retain their stated intent.

User answer: **pending**. Recommendation is not an accepted criterion.

## Agreed acceptance criteria

None yet. Add `J01-AC01`, etc. only after the user has resolved the associated decision. Record
observable outcomes, negative cases and the decision ID, rather than copying existing assertions.

## Findings

| ID | Status | Finding / impact | Disposition |
| --- | --- | --- | --- |
| J01-F01 | Observed; product decision pending | Homepage “all properties” leads to Residential-only search. Commercial inventory may be missed without an explicit narrowing choice. | Resolve J01-D01 before correction. |
| J01-F02 | Observed usability question | All five sorting options are inside Advanced Filters, with newest selected; no separate sort control appeared in the main search view. | Discuss discoverability later; functionality is present, not a confirmed defect. |

## Remaining discussion branches

Queue these individually after J01-D01: market/coming-soon scope; what a result represents and
duplicate certainty; which complete Rental Terms pair a card should show; “newest” semantics;
budget units and zero values; unknown features and studios; filter application and reset; sort
discoverability; empty/error and continuation behavior; share/back behavior; mobile and keyboard.
Map privacy and source-review claims are tracked by the related journeys in the index.

## Progress checklist

- [x] Initial scope and relevant code/docs/test expectations inspected.
- [x] Initial plain-language behavior and desktop running-UI observations recorded.
- [ ] Alternate paths and remaining controls inspected.
- [ ] Product decisions settled one at a time.
- [ ] Acceptance criteria agreed.
- [ ] Corrections implemented and mapped to criteria.
- [ ] Diff reviewed against criteria and repository standards.
- [ ] Appropriate checks and corrected UI journey verified.
- [ ] Findings closed or explicitly deferred; ready to advance.

## Implementation, review and verification

No application corrections yet. No test pass is claimed. Initialization migrations and development
seed succeeded, and the browser observations above were performed. Automated suites are deferred
until criteria/corrections define what to verify. The audit remains on J01.
