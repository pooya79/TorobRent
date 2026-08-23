# Milestone validation

Issue #17 closes the local-demo milestone through externally observable checks. The fixture catalog
is fictional and is not live crawler inventory.

## Coherent product story

`pnpm test:e2e:milestone` selects the `@milestone` Playwright slices as one product narrative:

1. `account-journey.spec.ts` registers a Submitter, follows the Mailpit verification link, signs in,
   creates a server-backed guided draft, uploads media, proves persistence and responsive navigation.
2. `submission-review.spec.ts` submits complete drafts, requests and displays changes, resubmits,
   rejects, groups, publishes, exposes approved direct contact, records aggregate events, confirms
   unchanged availability, and archives.
3. `catalog-journey.spec.ts` exercises anonymous search, same-Listing filters, URL and return state,
   empty results, mobile filters, stable Property URLs, multiple source Listings, disagreements,
   external continuation, direct continuation, grouping and source deactivation.
4. `smoke.spec.ts` proves mobile navigation, route focus, filter-dialog focus containment and
   restoration, same-origin readiness, protected return navigation, SSR and the Persian error page.
5. `accessibility.spec.ts` runs WCAG 2.2 AA automated checks at mobile and desktop sizes and verifies
   the reduced-motion contract. Unit and component suites additionally cover loading, validation and
   API failure states.

The time boundary is covered at the public HTTP/model seam in `test_listing_availability.py`: stale
Listings leave anonymous search, the dashboard exposes expiry, and Availability Confirmation renews
unchanged information without bypassing moderation.

## Release gates

| Gate | Repeatable command | Bound or coverage |
| --- | --- | --- |
| Repository quality | `make check` | Ruff, Prettier, ESLint, mypy, TypeScript, pytest coverage ≥85%, Vitest, migrations/API drift and production build |
| Supported browsers | `cd frontend && pnpm test:e2e` | Full mutable story on Playwright Chromium (current Chrome and Edge-compatible engine); representative public, responsive, focus, error and WCAG checks on Firefox and WebKit |
| Milestone narrative | `cd frontend && pnpm test:e2e:milestone` | Renter, Submitter and Operator story selected across maintainable slices |
| WCAG automation | `cd frontend && pnpm test:a11y` | Axe WCAG 2.2 AA on `/`, `/search`, `/guide` and `/contact`, plus reduced motion |
| Public performance | `cd frontend && pnpm test:lighthouse` | Two local production runs per URL; performance and accessibility ≥0.90, CLS ≤0.10, optimized and responsive images |
| Query growth | `cd backend && uv run pytest tests/test_catalog.py -k query_count` | Representative 60-Property/80-Listing search and detail remain at no more than two SQL queries each |
| Docker lifecycle | `make test-demo` | Idempotent seed, persona access, persistent database/media restart, scoped reset and cleanup |
| Whole milestone | `make test-milestone` | Runs repository checks, the selected browser story, Lighthouse and Docker lifecycle proof |

CI installs all three Playwright engines, runs the full supported-browser suite and Lighthouse after
unit/type/build gates, builds production containers, then executes the destructive lifecycle smoke
inside its isolated `torobrent-demo-smoke` Compose project.

## Manual review boundary

Automated Axe and Lighthouse results do not replace human assistive-technology review. Before a
public beta, repeat the story with a Persian-speaking keyboard-only reviewer and at least one current
screen reader/browser pairing, and perform a visual contrast/read-order check at 200% zoom.

## Residual public-beta prerequisites

The milestone deliberately remains a local demonstration. A public beta still requires a reviewed
live-data ingestion policy, authorized inventory and media, production hosting/TLS, secrets and SMTP,
monitoring/backups, abuse operations, legal/privacy approval, and a measured screen-reader review.
No crawler, external infrastructure, fixture-to-public migration, or third-party media copying is
part of this milestone.
