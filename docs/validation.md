# Integrated milestone validation

Issue #91 closes the integrated Submitter acquisition milestone through externally observable
checks. The fixture catalog and Source Proposal discovery are deterministic simulations; neither is
live crawler inventory.

## Coherent product story

`pnpm test:e2e:milestone` selects the `@milestone` Playwright slices as one product narrative:

1. `account-journey.spec.ts` starts at `/advertise`, preserves the protected onboarding destination
   through registration and Mailpit email verification, adds a verified phone to that same account,
   exposes both onboarding choices, and selects the manual Property branch. It creates a
   server-backed guided draft with the account phone, uploads media, proves reload and logout/login
   recovery, signs back in with the verified phone, and reaches a review-ready Submission.
2. `submission-review.spec.ts` independently registers and verifies a Submitter, then preserves that
   identity through submission, an explicit Operator handoff, requested changes, resubmission,
   rejection, grouping and publication. It proves public expiry, Submitter Availability
   Confirmation, renewed visibility, an independently verified alternate public contact, aggregate
   events and archival.
3. `source-proposal-review.spec.ts` selects the website branch in the browser, creates and autosaves
   a Source Proposal, reloads it, confirms the explicitly labeled simulated preview, and submits it.
   It then proves requested changes, resubmission, authoritative versioned dashboard history, Source
   approval without publication, two deterministic External Listing candidates, and independent
   decisions that publish one candidate and reject the other.
4. `catalog-journey.spec.ts` exercises anonymous search, same-Listing filters, URL and return state,
   empty results, mobile filters, stable Property URLs, multiple source Listings, disagreements,
   external continuation, direct continuation, grouping and source deactivation.
   `property-discovery.spec.ts` then uses the deterministic fake map and demo catalog for one
   Chromium desktop journey across city/category selection, map viewport state, infinite loading,
   Property return restoration, verified-phone Favorite authentication and saved state, plus one
   focused mobile keyboard/focus journey across Advanced Filters, map mode and bottom-sheet
   previews. The public-HTTP assertion also proves filtered SSR results remain non-indexable.
5. `smoke.spec.ts` proves mobile navigation, route focus, filter-dialog focus containment and
   restoration, same-origin readiness, protected return navigation, SSR and the Persian error page.
6. `accessibility.spec.ts` runs WCAG 2.2 AA automated checks on public pages at mobile and desktop
   sizes and verifies the reduced-motion contract. The supported-browser gate additionally seeds
   the demo catalog and exercises all six canonical surfaces in Light and Dark. `theme.spec.ts`
   proves pre-hydration restoration, real reload and cross-tab persistence, live System-mode
   changes, fixed explicit modes, invalid-storage recovery and the no-JavaScript fallback. Unit and
   component suites additionally cover loading, validation and API failure states.
7. Backend public-HTTP tests prove expired and exhausted OTP recovery and that production mode never
   includes an OTP in account or alternate-contact responses. Component tests prove omitted codes
   never reach markup. Migration tests move existing verified-email accounts and persisted
   Submission data through the account-phone and alternate-contact migrations without loss.

The Playwright narrative marks an approved Listing expired through the Operator admin, proves that
it leaves the public Property, then returns to the original Submitter to confirm availability and
restore it. `test_listing_availability.py` separately proves the scheduled time-boundary transition
at the public HTTP/model seam without browser-only setup.

## Release gates

| Gate                | Repeatable command                                                 | Bound or coverage                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository quality  | `make check`                                                       | Ruff, Prettier, ESLint, mypy, TypeScript, pytest coverage ≥85%, Vitest, migrations/API drift and production build                                                                                                            |
| Supported browsers  | `cd frontend && pnpm test:e2e`                                     | Full mutable story and deterministic integrated Property discovery on Playwright Chromium (current Chrome and Edge-compatible engine); representative public, responsive, focus, error and WCAG checks on Firefox and WebKit |
| Milestone narrative | `cd frontend && pnpm test:e2e:milestone`                           | Starts an isolated Mailpit container and runs the non-skippable Renter, Submitter, Operator and integrated Property-discovery story across maintainable slices                                                               |
| WCAG automation     | `cd frontend && pnpm test:a11y`                                    | Axe WCAG 2.2 AA on the public cross-browser set and all six canonical surfaces in Light and Dark, plus reduced motion                                                                                                        |
| Public performance  | `cd frontend && pnpm test:lighthouse`                              | Three local production runs per URL; median performance and pessimistic accessibility ≥0.90, pessimistic CLS ≤0.10, optimized and responsive images                                                                          |
| Query growth        | `cd backend && uv run pytest tests/test_catalog.py -k query_count` | Representative 60-Property/80-Listing search and detail remain at no more than two SQL queries each                                                                                                                          |
| Docker lifecycle    | `make test-demo`                                                   | Idempotent seed, persona access, persistent database/media restart, scoped reset, and removal of project containers, volumes and local images                                                                                |
| Whole milestone     | `make test-milestone`                                              | Runs repository checks, the selected browser story, Lighthouse and Docker lifecycle proof                                                                                                                                    |

CI installs all three Playwright engines, runs the full supported-browser suite and Lighthouse after
unit/type/build gates, builds production containers, then executes the destructive lifecycle smoke
inside its isolated `torobrent-demo-smoke` Compose project.

## Manual review boundary

Automated Axe and Lighthouse results do not replace human assistive-technology review. The browser
gate verifies keyboard focus containment/restoration, a rendered focus indicator, RTL direction,
semantic landmark/heading order and reduced motion; Axe covers labels, errors and contrast. Before
a public beta, repeat the story with a Persian-speaking keyboard-only reviewer and at least one
current screen reader/browser pairing, and perform a visual contrast/read-order check at 200% zoom.

## Residual public-beta prerequisites

The milestone deliberately remains a local demonstration. A public beta still requires a reviewed
live-data ingestion policy, authorized inventory and media, production hosting/TLS, secrets and SMTP,
monitoring/backups, abuse operations, legal/privacy approval, and a measured screen-reader review.
No crawler, external infrastructure, fixture-to-public migration, or third-party media copying is
part of this milestone.
