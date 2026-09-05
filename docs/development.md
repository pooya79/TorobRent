# Development

## Commands

- `make bootstrap`: synchronize Python/frontend lockfiles and install Chromium for the pull-request
  browser contract. Before a manual cross-browser run on a fresh Linux host, install all engines
  and their system libraries with
  `cd frontend && pnpm exec playwright install --with-deps chromium firefox webkit`.
- `make dev`: run the complete development environment in Compose.
- `make prod` / `make prod-down`: start or stop the production Compose stack using
  `.env.production`.
- `make infra-up`: run only PostgreSQL and Redis for host-based development.
- `make migrate` / `make makemigrations`: manage database schema changes.
- `make api-client`: regenerate OpenAPI and TypeScript API types.
- `make lint`, `make format`, `make format-check`, `make typecheck`, `make test`, `make build`:
  focused checks.
- `cd frontend && pnpm test:e2e`: run the focused browser contract on Chromium with local frontend
  and Django test runtimes.
- `cd frontend && pnpm test:e2e:cross-browser`: manually run the browser contract on Chromium,
  Firefox, and WebKit.
- `cd frontend && pnpm test:e2e:compose`: run the Chromium contract through the nginx gateway after
  `make dev` is ready.
- `make check`: run the full local validation suite.
- `make test-milestone`: run all repository gates, the cross-browser contract, and Lighthouse.
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
After registration, a password-reset request, or an unverified login, the frontend shows a
development-only link to that inbox. Find the message addressed to the email you entered and open
the verification or reset link inside it. Set `VITE_MAILPIT_URL` if the browser-facing inbox URL
differs; production builds leave it unset and do not show this guidance.
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

The frontend selects its map adapter at build time with `VITE_MAP_ADAPTER`. Supported values are
`openstreetmap` (the default), `neshan`, and the test-only `fake` adapter. Neshan reads
`VITE_NESHAN_MAP_KEY`; use a domain-restricted key from the Neshan panel and never commit a real
key. With no Neshan key, search stays available in its degraded full-width layout.

The independent OpenStreetMap adapter uses upstream OpenLayers and needs no key. It defaults to
`https://tile.openstreetmap.org/{z}/{x}/{y}.png`; set `VITE_OPENSTREETMAP_TILE_URL` to an
OpenStreetMap-compatible tile service for production traffic. The public OpenStreetMap tile service
is donation-funded and must not be treated as an unlimited production CDN. Preserve the visible
OpenStreetMap attribution when changing the tile source.

The browser contract sets `VITE_MAP_ADAPTER=fake`, so it never contacts a map service. Perform the
following non-CI smoke check once with `openstreetmap` and once with `neshan`: run the frontend,
open `/search`, verify Persian/RTL controls and the provider's visible attribution, and confirm the
map remains keyboard-focusable. Try to zoom farther out than zoom 10 and drag the map center beyond
each edge of the Tehran Search Boundary; neither wheel nor pointer interaction should overshoot or
spring back. Select an outer cluster and confirm its fitted view also remains constrained.

Search constrains map centers to the **Tehran Search Boundary** at zoom 10 or closer. The boundary
is the WGS84 envelope of all 22 municipal-district polygons in Tehran Municipality's versioned
1401 `manategh.rar` dataset, padded geodetically by 2 km on each edge and rounded to six decimal
places:

- west `51.066861`, south `35.550177`, east `51.628331`, north `35.846495`
- source: `https://data.tehran.ir/صفحه-اصلی/سرزمین-و-آب-و-هوا/تقسیمات-شهری/`
- official archive: `manategh.rar` under the source page's 1401 GIS downloads
- downloaded archive SHA-256:
  `46fdd853f8c22257b297756a73b9ea691f4541203eb24396f56dd4b948194c13`

The source shapefile is EPSG:32639. Its complete vertex envelope was transformed to WGS84 before
adding latitude-aware 2 km offsets. The raw archive is not committed because the public download
does not state explicit redistribution terms. Recalculate and review the static boundary only
when the supported market or the municipality's district boundaries change; the application must
not fetch boundary geometry at runtime.

The default test suite uses SQLite for fast unit tests. CI sets `TEST_DATABASE_URL` to run the same
suite against PostgreSQL. Any query, constraint, locking, JSON, or transaction behavior should have
a PostgreSQL-backed test.

## Migrations and jobs

Migrations must be backwards compatible with the currently deployed application during rolling
deployments. Separate destructive schema cleanup from the release that stops using the data.

Celery tasks should accept stable IDs rather than serialized model instances, tolerate retries, and
call domain services. Set explicit timeouts for external calls. Enqueue only after the database
transaction commits.

Submission media uses Django's default local storage on the named `media-data` Compose volume.
JPEG, PNG, and WebP uploads are validated by content and are limited to 10 MiB by default; set
`SUBMISSION_IMAGE_MAX_BYTES` to change that local limit. The permanent Celery worker creates
metadata-free responsive WebP variants, while Celery beat removes temporary uploads abandoned for
more than 24 hours. Media is served only through authenticated application endpoints, never as a
public media directory.

## Explicit Source Profile repair

Set `SOURCE_PROFILE_REPAIR_API_KEY` and `SOURCE_PROFILE_REPAIR_MODEL` to enable the Operator's
**درخواست اصلاح هوشمند** action. Choose a model available to your account that supports Chat
Completions and strict structured outputs. Empty settings leave manual editing available and
return an audited `not_configured` outcome for explicit repair requests. Compose passes these
settings to the backend; host-based development must export them in its shell. No test uses real
credentials or calls the model service.

The action accepts one to four explicitly selected fields and a client-generated request UUID.
Repeating the same request returns the retained case state without another model call. Another
request for the same version is refused while an attempt is pending. Each new attempt requires a
new explicit Operator action. Discovery, retries, drift, extraction and scheduled tasks do not
import the repair workflow or call the model.

The adapter makes one HTTPS request to OpenAI Chat Completions with strict JSON output, tools
disabled, storage disabled, a 20-second transport deadline, a 4,096-token output cap, and a 64 KiB
response cap. Its schema accepts only bounded CSS or JSON-LD field rules; manual editing retains
the broader existing declarative language. See the
[official structured-output contract](https://developers.openai.com/api/docs/guides/structured-outputs).

Model input contains only the selected fields' observation locators and snippets from up to five
training samples, with three observations per field/sample. Locators are capped at 300 characters
and snippets at 240 after phone, email and URL redaction. Raw HTML, page URLs, other fields and
held-out samples are excluded. Source Profile validation still uses the retained original training
and held-out split. All core fields and the selected fields must pass before a new proposed
version is created; approval remains a separate Operator decision.

Immutable request/result records retain actor, parent, selected fields, model, prompt/schema
versions, SHA-256 of the exact redacted evidence, bounded redacted structured output, validation,
start/finish times, duration and outcome. Failures preserve prior versions and the active pointer.
If a process dies after recording the request, its history shows `interrupted` after 60 seconds;
refresh the case and explicitly submit a new request if appropriate. No recovery task retries it.

## External Listing Images

Discovery previews and Extraction Run candidates own their image staging records. URL approval
permits the exact Source host; an Operator with Source Proposal Review capability can approve
additional exact CDN hosts through **Source image hosts** in Django administration. Approval keeps
the reviewer and timestamp, host edits are disabled, and revocation stops subsequent downloads.
No Submission is created for external media.

Each Discovery or Extraction Run processes at most twelve source-ordered image URLs. Every image
uses HTTPS, revalidates DNS and host approval across redirects, pins the public connection address,
and shares a 15-second deadline across its redirect chain (at most five redirects). Encoded input
is limited to 10 MiB and decoded JPEG/PNG/WebP input to 40 million pixels. The shared processor
strips metadata and produces 480/960/1440-pixel WebP variants.

Extraction commits valid rental facts before enqueueing the separate media task. Media tasks use
stable run/reservation IDs, late acknowledgement, bounded retries, and 240/300-second soft/hard
limits. Redelivery skips completed images. A durable Candidate Image owns its storage directory
before processing, allowing interrupted output files to be reclaimed on retry or retirement.
Image failure is recorded in candidate media and run errors and does not prevent publication.
Published candidates receive completed images only while they remain the Listing's current source
reference, so a delayed older run cannot overwrite a newer run's gallery.

Operators can inspect first-party thumbnails while reviewing exceptions, reorder or exclude
images, and choose a primary image. The separate Property Image checkbox records explicit
acceptance and the reviewer; ordinary publication keeps the image source-specific. Public variants
are served through the catalog media endpoint only while a public active Listing references them
or the reviewed Property. Original Source image URLs are retained as private evidence.

The hourly `cleanup_external_images` task preserves bytes referenced by any active Listing or
reviewed Property. Unreferenced images receive a 30-day grace period, measured from known
withdrawal/expiry or conservatively from the first unreferenced observation. Cleanup removes
variant references and files but retains original URL, hash, processing status, and dimensions.
