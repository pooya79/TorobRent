# Integrated milestone validation

TorobRent concentrates behavior at the narrowest reliable test seam. Backend tests own domain and
HTTP behavior, React tests own rendered states and interactions, and the Playwright browser contract
owns only behavior that requires a composed application in a real browser.

## Browser contract

`pnpm test:e2e` runs eight focused checks on Chromium in pull requests and pushes to `main`:

1. Persian SSR and failure documents are meaningful before hydration.
2. The React shell hydrates and reaches Django through the same origin.
3. Protected Operator navigation survives a real login.
4. The mobile search layout remains contained and restores visible focus.
5. An explicit theme is applied before hydration.
6. Theme selection persists across reloads and synchronizes across tabs.
7. Public routes pass automated WCAG checks with reduced motion.
8. The no-JavaScript document follows the operating-system theme.

The manually dispatched `Browser contract` GitHub Actions workflow runs the same contract on
Chromium, Firefox, and WebKit. A local equivalent is:

```bash
cd frontend
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm test:e2e:cross-browser
```

Long browser role narratives are deliberately excluded. Account access, Submission and Submission
Review, Source Proposal review, Support Request handling, Property discovery, Listing availability,
Favorite behavior, and Operator Capability rules are covered at the backend HTTP/model and React
interfaces. Manual product review remains useful but is not a release gate.

## Release gates

| Gate                          | Repeatable command                                                 | Coverage                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository quality            | `make check`                                                       | Ruff, Prettier, ESLint, mypy, TypeScript, pytest coverage ≥85%, Vitest, migrations/contract drift, and production build                             |
| Chromium browser contract     | `cd frontend && pnpm test:e2e`                                     | SSR, hydration, same-origin routing, login return, focus/layout, theme persistence, Axe, reduced motion, and no-JavaScript behavior                 |
| Manual cross-browser contract | GitHub Actions → `Browser contract` → Run workflow                 | The browser contract on Chromium, Firefox, and WebKit                                                                                               |
| Public performance            | `cd frontend && pnpm test:lighthouse`                              | Three local production runs per URL; median performance and pessimistic accessibility ≥0.90, pessimistic CLS ≤0.10, optimized and responsive images |
| Query growth                  | `cd backend && uv run pytest tests/test_catalog.py -k query_count` | Representative 60-Property/80-Listing search and detail remain at no more than two SQL queries each                                                 |
| Whole milestone               | `make test-milestone`                                              | Repository checks, the manual cross-browser contract, and Lighthouse                                                                                |

CI installs Chromium and runs the compact browser contract after frontend unit/type/build gates.
Firefox and WebKit are installed only for an explicitly requested cross-browser run. Lighthouse
then runs in the ordinary frontend job, and production containers remain the downstream release
gate.

## Manual review boundary

Automated Axe and Lighthouse results do not replace human assistive-technology review. Before a
public beta, repeat the critical journeys with a Persian-speaking keyboard-only reviewer and at
least one current screen reader/browser pairing, and perform a visual contrast/read-order check at
200% zoom.

## Residual public-beta prerequisites

The milestone does not establish public-beta readiness. A public beta still requires a reviewed
live-data ingestion policy, authorized inventory and media, production hosting/TLS, secrets and
SMTP, monitoring/backups, abuse operations, legal/privacy approval, and a measured screen-reader
review. No crawler, external infrastructure, fixture-to-public migration, or third-party media
copying is part of this milestone.
