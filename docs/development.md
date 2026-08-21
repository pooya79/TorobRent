# Development

## Commands

- `make bootstrap`: synchronize Python and frontend lockfiles.
- `make dev`: run the complete development environment in Compose.
- `make prod` / `make prod-down`: start or stop the production Compose stack using
  `.env.production`.
- `make infra-up`: run only PostgreSQL and Redis for host-based development.
- `make migrate` / `make makemigrations`: manage database schema changes.
- `make api-client`: regenerate OpenAPI and TypeScript API types.
- `make lint`, `make format`, `make format-check`, `make typecheck`, `make test`, `make build`:
  focused checks.
- `cd frontend && pnpm test:e2e`: run the SSR/browser smoke suite with local frontend and Django
  test runtimes.
- `cd frontend && pnpm test:e2e:compose`: run the same smoke suite through the nginx gateway after
  `make dev` is ready.
- `make check`: run the full local validation suite.
- `make docker-build`: verify both production images.

Python dependencies are declared in `backend/pyproject.toml` and locked with `uv`. JavaScript
dependencies are declared in `frontend/package.json` and locked with pnpm. Update dependencies in a
dedicated change, regenerate both locks, read major/minor release notes, and run `make check` plus
`make docker-build`.

Node type definitions intentionally track the Node 24 runtime. TypeScript is pinned to the newest
6.x release until `typescript-eslint` supports TypeScript 7; `npm outdated` will report those two
expected differences from the registry's unrestricted latest tags.

The default `compose.yaml` is development-only: it bind-mounts source and runs the React Router
development runtime plus Uvicorn with reload enabled, behind nginx on port 5173.
Mailpit captures local registration and recovery email; its inbox is available at
`http://localhost:8025`, and captured links return to the frontend at `http://localhost:5173`.
`compose.prod.yaml` builds immutable production targets, keeps data services private, runs
migrations as a one-shot service, and uses the React Node runtime, Uvicorn, and nginx. Copy
`.env.production.example` to `.env.production` and replace all placeholder credentials before
starting it.

## Configuration

Copy `.env.example` and never commit real secrets. Local defaults are intentionally obvious and
unsafe for production. Production settings require a real secret, allowed hosts, and CSRF trusted
origins and enable secure cookies, HTTPS redirection, and HSTS.

If PostgreSQL or Redis already occupies the default host port, change `POSTGRES_PORT` or
`REDIS_PORT` in `.env` and update the corresponding host-based connection URL. Containerized
backend services continue to use the internal ports.

The default test suite uses SQLite for fast unit tests. CI sets `TEST_DATABASE_URL` to run the same
suite against PostgreSQL. Any query, constraint, locking, JSON, or transaction behavior should have
a PostgreSQL-backed test.

## Migrations and jobs

Migrations must be backwards compatible with the currently deployed application during rolling
deployments. Separate destructive schema cleanup from the release that stops using the data.

Celery tasks should accept stable IDs rather than serialized model instances, tolerate retries, and
call domain services. Set explicit timeouts for external calls. Enqueue only after the database
transaction commits.
