# Development

## Commands

- `make bootstrap`: synchronize Python/frontend lockfiles and install Chromium for the pull-request
  browser contract. Before a manual cross-browser run on a fresh Linux host, install all engines
  and their system libraries with
  `cd frontend && pnpm exec playwright install --with-deps chromium firefox webkit`.
- `make dev`: run the complete development environment in Compose.
- `make seed-dev`: create or refresh deterministic local personas and workflow data in the running
  Compose backend. It is safe to rerun and does not overwrite records changed after their first
  creation.
- `make dev-down`: remove development containers and networks while keeping data and dependency
  volumes. The frontend persists both `node_modules` and its pnpm download store; startup still
  runs a frozen-lockfile install to synchronize dependencies. The store may need to download
  packages once when first populated, but is reused after subsequent container recreations.
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

## Development seed personas

Run `make seed-dev` after migrations. All seed data is fictional, local-only, and guarded from
production settings. The command prepares these login accounts:

| Persona | Email | Password | Intended surface |
| --- | --- | --- | --- |
| Submitter/owner | `submitter@torobrent.local` | `dev-submitter` | Submission states, notifications, support, inquiries |
| Renter | `renter@torobrent.local` | `dev-renter` | Active unread listing conversation |
| Second renter | `renter-two@torobrent.local` | `dev-renter-two` | Read-only conversation for an expired listing |
| Full operator | `operator@torobrent.local` | `dev-operator` | Every operator surface and admin |
| Submission reviewer | `reviewer@torobrent.local` | `dev-reviewer` | Submission review without superuser access |
| Support operator | `support@torobrent.local` | `dev-support` | General support queue without superuser access |

The dataset includes all catalog listing states, all six submission states with review history,
submission decision notifications with both read and unread examples, two listing inquiries with
five alternating messages, and support requests in open, in-progress, escalated, and resolved
states. Seeded workflow rows use stable UUIDs. Rerunning fills in missing fixtures but deliberately
preserves passwords, message edits, and workflow changes made during manual testing.

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

## Source Discovery limits

URL approval and explicit profile re-review require the Operator to choose `max_pages` and
`target_detail_pages`, using the representative's displayed inventory estimate. Both are positive
integers; the detail target cannot exceed the page budget. Each Source Reservation retains the
chosen limits and exposes them with Discovery evidence. Existing reservations retain their previous
50-page/30-detail limits through migration defaults; new API approvals require explicit values.
Discovery stops when either limit is reached or its frontier is exhausted. It still follows links
only two levels deep, and the Celery task's 600/660-second soft/hard limits still apply, so a large
budget does not guarantee that many pages will be fetched. The fetcher's 50-URL per-batch limit is
separate: Discovery fetches one URL per call and can visit more than 50 URLs in total.

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
and held-out split. Safe executable rules create an immutable proposed version even when selected or unrelated fields
still fail quality checks. Malformed or unsafe output remains an unsuccessful recorded attempt.
The active version stays unchanged until the Operator explicitly approves the draft, chooses a
publication mode, and acknowledges any limitations with a reason.

The Operator sees a before/after comparison of changed rules, independent-validation counts and
coverage, and affected sample values/conflicts. Improvements and regressions mean a field became
resolved or stopped being resolved; changed resolved values are not claimed as improvements.
Training and held-out samples are labeled separately. Comparisons use the immutable parent and
draft evidence, so they survive snapshot expiry without re-fetching pages or rewriting history.

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


Source retention tasks run hourly with 240/300-second soft/hard deadlines and at most 200 records
per invocation. `cleanup_source_snapshots` deletes expired 30-day HTML input; profile evidence and
model-call audits remain durable. Fetch adapters currently store no screenshots.
`cleanup_external_images` visits the least-recently checked records first, including retired
records whose file deletion may need retry, so retained images cannot starve later cleanup work.

Deploy source-proposal migrations 0022 and 0023 before switching application workers. Simulation
retirement preserves history and leaves its unused physical column with a default for compatibility;
a future release may drop that column after old workers are drained. Do not run old simulation
producers after retirement.

### One current website per Submitter (#122)

No schema or data migration is needed: introduction, proposal editing, URL approval, and profile
approval serialize on the existing Submitter account row before locking the proposal. An open
proposal (draft, pending, or changes requested) or an active assignment occupies the slot; a
profile review and its assignment count as the same case. The compatibility `start_new` hint
cannot bypass this rule. Drain old application workers when deploying this behavior.

Existing conflicting cases are preserved and flagged in the Submitter dashboard and Operator
queue. Creation returns 409 and editing/approval is blocked until explicit resolution. The
Submitter can discard a draft or changes-requested proposal without an active assignment; an
Operator can reject a pending proposal or revoke an assignment using the existing reasoned workflow. Revocation deactivates the
profile, cancels extraction work, and withdraws its published listings. Historical and discarded
proposals remain readable by their Submitter, with review and assignment history intact.

### Source Operator responsibility (#123)

Apply catalog migration 0015 and source-proposal migrations 0026–0027 before starting the new
application and workers. The data migration copies the approver from retained profile approval
(or legacy proposal approval) into current Source responsibility, retaining the original evidence.
Sources without approval evidence remain unassigned; a queue manager can assign an eligible
Operator on an active case. Drain older application processes during this rollout so they cannot
continue using original-approver authorization.

The Source's `responsible_operator` is the destination for future conversation and exception
notifications. Its `responsibility_revision` protects explicit, reasoned queue-manager
reassignment. Decision services reread responsibility and capability under the Source lock;
profile repair also checks the revision after the external call. Reassignment ends existing
review leases without deleting their history. A successor must claim pending reviews and
candidate exceptions using the existing time-limited claim workflow. Initial profile approval
assigns its approver; later profile approvals preserve current responsibility.

Responsibility email labels and reassignment history are Operator-only. The representative's
existing `assignment.review_operator` field now identifies the current responsible Operator;
approval evidence continues to identify the historical approver.

UI captures use deterministic local API fixtures:
[reassignment form](screenshots/issue-123-responsibility-before.png),
[retained history](screenshots/issue-123-responsibility-history.png), and
[mobile layout](screenshots/issue-123-responsibility-mobile.png).

Django Source administration displays responsibility read-only. Additional CDN-host approvals and
revocations use the same Source responsibility checks; during initial onboarding they require a
current Review Claim. Source responsibility changes go through the queue-manager action.

### Source Exclusions (#125)

Apply source-proposal migrations 0029–0030 before starting the application and workers. They add
separate immutable restriction/action records, nullable candidate holds, and a default empty list of
skipped pages; historical Discovery exclusions and profile validation remain unchanged. Drain older
workers during rollout so they cannot publish without the new exclusion checks.

The responsible Operator previews a normalized exact URL or a path section on the assigned host,
then supplies a reason and explicit confirmation. Exact URLs retain meaningful query parameters;
path sections ignore queries and match complete segments (`/archive` does not match `/archive-old`).
Preview uses retained known pages and published Listings, showing total counts and up to 100
examples of each. It performs no network discovery and never claims exhaustive coverage. Newly
recorded fetch failures retain their page URL so they can appear in subsequent previews.

Adding a restriction holds matching unpublished candidates under the same Source lock used by
worker completion and explicit approvals. Held candidates keep their original validation evidence;
removal does not release them for automatic publication, including when a rule is added and removed
while a run is in flight. Requested page URLs remain associated with redirected results, so those
URLs participate in publication holds, previews and withdrawal checks as well as the final URL.
A fresh request after removal can publish under the current publication
mode. An Operator may explicitly approve valid old results after the restriction is removed.

Excluded pages have separate recorded reasons in run history; actual fetch and validation failures
remain failures. Representatives see restrictions, retained decisions, skipped pages and held
results. Actor references remain in the audit records without exposing Operator account details in
the representative's restriction history.

Existing Listings remain published when an exclusion is added. The separate withdrawal action
requires a fresh preview, its displayed Listing IDs, a reason and explicit confirmation. The server
rechecks that every reviewed Listing is still published, belongs to this Source and matches the
active rule. Only those IDs are withdrawn; for more than 100 matches, preview and repeat explicitly.

Deterministic local API fixtures were used for UI inspection:
[known matches](screenshots/issue-125-exclusion-preview.png),
[no known matches](screenshots/issue-125-exclusion-empty.png),
[mobile](screenshots/issue-125-exclusion-mobile.png),
[separate withdrawal](screenshots/issue-125-exclusion-withdrawal.png), and
[representative history](screenshots/issue-125-exclusion-representative.png).

Validation for #125: the full PostgreSQL backend suite passed (710 tests, 92% coverage), followed
by focused regression checks for the redirect cases found in review. The focused Source React
suite passed. The full frontend suite has 16 pre-existing assertion failures across
`OperatorOverviewPage`, `OperatorReviewPage`, `OperatorSupportPage`, `OperatorWorkspace` and
`ResultsPage`; the same failures reproduce on the starting commit `5e13694`.

### Current Source extraction exceptions (#126)

Apply source-proposal migrations 0031–0032 before starting the new application and workers.
They add a unique Source/canonical-URL outcome, retained per-run attempt history, and a nullable
request initiator audit reference. Drain old workers during rollout. Existing runs, candidates,
corrections and exclusion history remain unchanged; current exception tracking starts with fresh
worker attempts rather than guessing original validation from manually corrected historical facts.

Worker completion records page outcomes under the Source lock. Request creation order and attempt
number fence older completions, including when the newer page succeeded without any prior failure.
Successful pages retain an internal ordering record but appear in the exception UI only after a
problem or exclusion has occurred. Repeated task delivery does not append duplicate history.
History labels attempts that were stale on arrival; current state is displayed separately.

Fresh candidates passing mandatory checks resolve their page exception before publication approval.
Manual correction changes only the candidate. Active exclusions override the visible current state;
a skipped page remains Excluded after removal until another attempt supplies fresh evidence.
Neither exceptions nor retry requests pause a Source or withdraw published Listings.

Both source screens show grouped affected pages, current counts, first occurrence, latest attempt,
and retained retry history. Representatives can inspect links and request extraction after fixing
the website; extracted facts remain Operator-editable only. The responsible Operator can also
request individual/group retries. Requests accept at most twenty exception IDs from the current
Source Assignment, with the existing twenty-page/depth-two fetch budget per request. Existing
queued/running work for the same assignment, profile and canonical entry URL is reused. Operator
retries retain the representative as the authorization principal and record the Operator separately
in `initiated_by`; loss of the assignment or active profile still cancels processing.

Live exception data is withheld from revoked assignments; their recorded Extraction Requests and
runs remain available as history. Removing an exclusion restores page/group retry controls while
retaining the historical Excluded label until fresh processing. Late earlier evidence can move
first occurrence backward without replacing the latest outcome.

Deterministic local API fixtures were used to inspect and capture the shared exception panel:
[Operator](screenshots/issue-126-exceptions-operator.png),
[representative](screenshots/issue-126-exceptions-representative.png), and
[mobile](screenshots/issue-126-exceptions-mobile.png). Mobile inspection found no horizontal overflow.

Validation for #126: all 727 PostgreSQL backend tests passed with 92.75% coverage. The full frontend
suite passed 299 tests and retained 16 pre-existing failures across OperatorOverviewPage,
OperatorReviewPage, OperatorSupportPage, OperatorWorkspace and ResultsPage. The identical sixteen
failing tests reproduce on starting commit `9d1942b`. All Source tests passed. Lint, formatting,
backend/frontend types, generated API drift/validation, migration drift and production build passed.
Both Standards and Spec reviews have no remaining findings after regression-tested fixes.

### Source processing pause and fresh work (#128)

Apply catalog migration 0016 and source-proposal migrations 0033–0034 before starting the new
application and workers. Existing Sources default to processing enabled at revision zero; existing
requests retain that revision and historical candidates remain unchanged. Drain old application
and Celery workers during rollout so they cannot publish without the new revision checks.

The responsible Operator pauses processing independently of Source Assignment revocation and
Listing withdrawal. Pause blocks new extraction and unfinished publication, including explicit
candidate/run approval. Published Listings keep their ordinary availability and expiry. An
immediate, private notification records each pause/resume, and both Source screens show status.
Resume requires a fresh publication-mode choice and enqueues bounded extraction from the approved
website URL (the existing twenty-page, depth-two limits). It reads current exclusions and pages;
retained HTML and automatic publication permission are never replayed.

An unapproved profile draft leaves the approved profile usable. Approving its replacement advances
the processing revision and starts fresh extraction with the explicitly selected mode. Approval
while paused preserves the pause; the Operator must resume separately. Processing transitions do
not change the profile-review revision, so a pause during draft review cannot invalidate its
reservation or evidence. Old workers and explicit approvals must match the current processing
revision, active profile and Assignment under the Source lock.

Fresh page outcomes supersede older pending candidates for the same Source URL without rewriting
their evidence, corrections, decisions, or published Listings. Request creation order also fences
out-of-order completions and retries: older candidates remain historical and cannot overwrite a
newer publication or withdrawal outcome. Superseded candidates disappear from the current review
queue but remain visible in run history. Legacy candidates without an Extraction Request are
retired from pending review when the processing revision changes.

Deterministic local fixtures were used to inspect the actual Source components and capture
[active processing](screenshots/issue-128-processing-active.png),
[Operator resume](screenshots/issue-128-processing-operator.png),
[representative status](screenshots/issue-128-processing-representative.png), and
[mobile layout](screenshots/issue-128-processing-mobile.png). Desktop and mobile captures have no
horizontal overflow.

Validation for #128: the full PostgreSQL backend run passed 752 tests with 92.85% coverage and
found one Django-admin regression caused by the new processing fields. Those fields are now
read-only, with attempted bypasses covered; the subsequent PostgreSQL run passed all 31 pause and
responsibility tests, including profile approval while paused. The full frontend run passed 309
tests and reproduced exactly the same sixteen pre-existing failures on starting commit `8c1caf3`
in OperatorOverviewPage, OperatorReviewPage, OperatorSupportPage, OperatorWorkspace and ResultsPage.
The representative-screen suite passed all twelve tests, including live pause updates and returning
after a revoked case was cached. Production build, lint, formatting, backend/frontend types,
API validation/drift, and migration drift passed. Standards and Spec reviews have no remaining
findings; the polling cache finding was fixed and regression-tested.
