# Repository Guidelines

## Project Structure & Module Organization

Django configuration lives in `backend/config/`, domain applications under `backend/apps/`, and
tests in `backend/tests/`. React code is under `frontend/src/`, organized into `app/`, `pages/`,
`features/`, `components/`, and shared `lib/`. Frontend unit tests live in `frontend/tests/`, with
the focused Playwright browser contract in `frontend/tests/e2e/`. `contracts/openapi.yaml` is the
API contract; `frontend/src/lib/api/schema.d.ts` is generated from it. Project notes live in
`docs/`, while Compose and nginx configuration are at the repository root and in `infra/`.

## Build, Test, and Development Commands

- `cp .env.example .env && make dev`: build and run the full development stack with Compose.
- `make bootstrap`: install locked Python dependencies with `uv` and frontend dependencies with
  pnpm.
- `make infra-up`: start PostgreSQL and Redis for host-based development.
- `make migrate`: apply Django migrations.
- `make test`: run pytest with coverage, then Vitest.
- `cd frontend && pnpm test:e2e`: run the Chromium browser contract.
- `cd frontend && pnpm test:e2e:cross-browser`: manually run it on Chromium, Firefox, and WebKit.
- `make check`: run linting, formatting, types, tests, API drift checks, and the frontend build.

## Coding Style & Naming Conventions

Python targets 3.14, uses four-space indentation, a 100-character line limit, Ruff formatting and
linting, and strict mypy. Use `snake_case` for functions/modules and `PascalCase` for classes.
TypeScript/TSX is formatted by Prettier and checked by ESLint with type-aware and React Hooks rules.
Use `PascalCase.tsx` for React components/pages and descriptive lowercase filenames for utilities.
Persian copy must use plain `ه` at word endings; never use the hamza forms `هٔ` or `ۀ`.
Run `make format`, `make lint`, and `make typecheck`; pre-commit hooks enforce the main checks.

## Testing Guidelines

Pytest discovers `backend/tests/test_*.py`; mark database tests with `@pytest.mark.django_db`.
Backend coverage must remain at least 85%. Vitest discovers `frontend/tests/**/*.test.ts(x)` and
uses Testing Library with MSW. Keep Playwright focused on behavior that requires a real browser.
Omit redundant end-to-end tests when backend or React tests already cover the same behavior.
Exercise database-specific behavior against PostgreSQL.

## Commit & Pull Request Guidelines

Write commit subjects as `<type>(<scope>): <message>`. Use a concise type such as `feat`, `fix`,
`chore`, `scaffold`, `test`, or `docs`; choose a scope such as `backend`, `frontend`, or `infra`.
More detailed scopes may be nested, for example `feat(backend(users)): add profile endpoint` or
`fix(frontend(api)): handle expired sessions`. Keep the message imperative and commits focused.
Pull requests should explain intent and user-visible impact, link relevant issues, list validation
performed, and include screenshots for UI changes. Commit migrations and regenerated
OpenAPI/client artifacts whenever their source changes; never hand-edit generated schema types.

## Security & Configuration

Never commit secrets or production credentials. Copy the provided environment examples locally,
and review `docs/development.md` before changing deployment, migrations, or Celery jobs.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `pooya79/TorobRent`. See
`docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See `docs/agents/domain.md`.
