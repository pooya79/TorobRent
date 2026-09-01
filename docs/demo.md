# Deterministic local demo

This package is a repeatable reviewer environment for TorobRent. Its catalog and personas are
fictional fixtures: they are not live crawler inventory and must not be used for a real rental
decision.

## Prerequisites

Install Docker Engine with the Compose plugin on Linux, or Docker Desktop on macOS. On Windows,
use Docker Desktop with its WSL2 backend and run the commands from a WSL2 terminal. GNU Make is the
only host command used by the happy path; local Python, Node.js, PostgreSQL, Redis, SMTP, DNS, TLS,
S3, Sentry, cloud accounts, and vendor credentials are not required.

Allow roughly 4 GB of free memory and 6 GB of free disk space for images, build cache, and named
volumes. Ports 5173 and 8025 must be available. They can be changed in the generated `.env.demo`.

## Start

From the repository root, run one command:

```bash
make demo
```

On the first run it copies `.env.demo.example` to the ignored `.env.demo`, builds one
`torobrent-demo` Compose topology, waits for PostgreSQL and Redis, applies migrations, seeds the
database idempotently, and waits for the gateway to become healthy. Subsequent runs preserve local
database changes and uploaded media, leaving existing fixture records untouched while filling any
missing stable fixture IDs.

## URLs and personas

The command prints these coordinates when startup succeeds:

| Purpose       | URL or credentials                             |
| ------------- | ---------------------------------------------- |
| Application   | <http://localhost:5173>                        |
| Django admin  | <http://localhost:5173/admin/>                 |
| Mailpit inbox | <http://localhost:8025>                        |
| Liveness      | <http://localhost:5173/api/v1/system/live/>    |
| Readiness     | <http://localhost:5173/api/v1/system/ready/>   |
| Submitter     | `submitter@torobrent.local` / `demo-submitter` |
| Operator      | `operator@torobrent.local` / `demo-operator`   |

These weak passwords and the Operator superuser status are local-only demo conveniences.

## Complete walkthrough

1. Open the application and search without signing in. The 54 searchable Properties span three
   result pages, all residential types, all Feature States, zero-deposit and zero-rent boundaries,
   and varied Rental Terms.
2. Open a Property with multiple Listings. Compare its source-specific Rental Terms and explicit
   disagreements. Some fictional sources are authorized to show bundled placeholder illustrations;
   other Listings deliberately exercise the no-media presentation.
3. Sign in as the Submitter and open `/dashboard`. Inspect prepared drafts, requested changes,
   rejection, publication, and an expired Listing. The pending Submission also appears in the
   review queue.
4. Sign out, sign in as the Operator, and open `/operator/submissions`. Filter the queue, inspect the
   prepared submission history, then open `/admin/` to inspect all workflow and Listing states.
5. Register a separate account at `/register`. Open Mailpit to follow its verification link. Use
   the development-only inbox link shown by the application, find the message addressed to the
   email you entered, and follow its verification link. Use `/forgot-password` to confirm
   password-reset mail is also captured locally and never delivered to an external SMTP server.
6. Open `/guide` and `/contact` to review the alpha guidance and Operator-managed contact flow.

## Troubleshooting

- Run `docker compose -p torobrent-demo --env-file .env.demo -f compose.demo.yaml ps` to see health
  and one-shot migration/seed status.
- Run `docker compose -p torobrent-demo --env-file .env.demo -f compose.demo.yaml logs --tail=200`
  for startup logs. Django request and failure records are structured JSON and include request IDs.
- A failed `migrate` or `seed` container prevents the backend from starting. Inspect that specific
  container with the same `logs migrate` or `logs seed` command.
- If a port is occupied, edit `DEMO_APP_PORT` or `DEMO_MAILPIT_PORT` in `.env.demo`, rerun
  `make demo`, and use the new printed port.
- If Docker reports insufficient memory or disk, increase Docker Desktop resources or prune only
  build cache you recognize; do not delete unrelated volumes.

## Stop and restart

Run `make demo-down` for an ordinary shutdown. It removes the demo containers and network but keeps
the `torobrent-demo_postgres-data` and `torobrent-demo_media-data` named volumes. Run `make demo`
again to restore the containers with database work and uploaded media intact.

## Reset

`make demo-reset` is destructive. It resolves the fixed `torobrent-demo` Compose project, deletes
only that project's database, cache, schedule, and uploaded-media volumes, and starts the topology
again from the deterministic seed. It does not run a global Docker prune or target another Compose
project.

Automated lifecycle coverage uses the isolated `torobrent-demo-smoke` project and alternate ports:

```bash
make test-demo
```

The smoke verifies an idempotent seed, both persona passwords, database and media persistence over
a full down/up cycle, and deterministic restoration after a volume-scoped reset.

The complete quality, browser-contract, accessibility, performance, query-bound, and lifecycle
evidence is mapped in [Milestone validation](validation.md). Run `make test-milestone` to execute the
whole local release gate; it is intentionally slower than the normal development checks.

## Clean uninstall

`make demo-clean` is destructive. It removes only `torobrent-demo` containers, network, named
volumes, and locally built demo images. The generated `.env.demo` remains ignored and can be removed
manually if its port overrides are no longer useful. Shared upstream images and unrelated Docker
projects are not pruned.
