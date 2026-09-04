# Source extraction

This document defines the focused first version for connecting TorobTest's extraction pipeline to
TorobRent. It extends the existing Source Proposal and External Listing candidate workflows; it
does not introduce a general crawler control center.

## Scope

The first version supports one exclusive Source Assignment and one Source Profile lineage per
external Source. A Source Representative submits URLs manually. One assigned Operator validates
the URL and the proposed Source Profile, using manual edits or explicitly requested, field-bounded
LLM repair. Approved profiles either require one batch approval per Extraction Run or
automatically publish valid results and route only exceptions to review.

The first version does not include scheduled recrawling, multiple profiles per Source, arbitrary
executable extraction rules, automatic LLM calls, public hotlinking, or a separate operational
dashboard.

## Workflow

1. A Source Representative creates a Source Proposal containing a website or catalog URL.
2. TorobRent performs no-fetch validation: syntax, normalized host, duplicate assignment or
   reservation, and obvious unsafe targets.
3. An Operator claims the case and validates the URL. Approval creates a temporary, expiring
   reservation of the normalized host for that representative.
4. A Celery task performs bounded Source Discovery. It applies SSRF protections, obeys fixed page,
   redirect, response-size, and time limits, identifies rental-detail pages, groups their
   structures, and records evidence and counts.
5. TorobRent selects the dominant supported detail-page structure and proposes one versioned Source
   Profile with training and held-out validation samples. Other structures remain excluded and are
   visible in the coverage summary.
6. The same renewable Review Claim returns to the Operator. The Operator may edit bounded
   declarative rules manually, explicitly request an LLM repair for selected fields, request
   changes, reject the proposal, or approve the profile. Every edit or LLM repair creates a new
   version and reruns deterministic validation.
7. Approval converts the reservation into the exclusive Source Assignment and activates one Source
   Profile version. The Operator chooses `approval_required` or `automatic` review mode.
8. Each later user-submitted URL creates an Extraction Request. Lightweight Source Discovery finds
   pages matching the active profile; unfamiliar structures become drift exceptions and never
   cause an automatic profile or LLM change.
9. The Extraction Run extracts valid pages, downloads and processes valid images, and stages
   External Listing candidates. A repeated canonical external URL updates the existing Listing
   instead of creating a duplicate.
10. In `approval_required` mode, one Operator reviews the run summary and samples and approves all
    valid results as a batch. In `automatic` mode, valid results publish automatically. In both
    modes, only exceptions enter individual candidate review.

## Publishable result

Publication requires city, district, neighborhood, Property Type, Floor Area, Bedroom Count when
applicable, deposit, and monthly rent. Optional attributes remain source claims and do not block
publication. Missing or conflicting required values create an exception.

A run may partially succeed: valid results proceed while invalid results wait for review. The
system never infers unavailability merely because a page was absent from a bounded or partial run.
It marks an existing Listing unavailable only when its page explicitly indicates removal, returns
a durable terminal response such as `404` or `410`, or an Operator decides it.

## Data additions

- **Source Reservation**: the temporary, expiring normalized-host reservation created by URL
  approval and released by rejection or abandonment.
- **Source Assignment**: the exclusive, revocable representative-to-Source relationship, including
  active, suspended, or revoked state plus immutable decision history.
- **Source Profile and versions**: one lineage per Source, one active approved version, declarative
  extraction rules, structural fingerprint, coverage evidence, review mode, and approval history.
- **Extraction Request**: submitted and canonical URL, Source Assignment, requester, state, and
  timestamps.
- **Extraction Run**: profile version, pipeline version, attempts, timing, page and result counters,
  terminal outcome, and bounded error summary.
- **External Listing candidate additions**: Extraction Run, canonical external URL, raw source
  claims, field evidence and conflicts, correction diff, and real rather than simulated provenance.
- **Candidate image staging**: original URL, order, primary marker, processing state, failure reason,
  content hash, and processed variant assets.

The global Source remains separate from its representative. Assignment policy must not be stored
only on Source because responsibility, revocation, and monitoring belong to the approved
representative relationship.

## Images

Discovery and extraction may download up to twelve ordered images per candidate after URL approval.
Downloads must use HTTPS and an Operator-approved Source or CDN host and must revalidate public IPs
on every redirect. They have fixed redirect, byte, pixel, and time limits and accept decoded JPEG,
PNG, or WebP content only.

Processing reuses TorobRent's media behavior: EXIF orientation correction, RGB conversion,
metadata-free WebP output, and responsive variants. Candidate-owned staging references shared
Media Assets. Publication promotes accepted assets to source-specific Listing Images. Only images
accepted in an Operator review may also become shared Property Images.

Image failure does not block an otherwise valid Listing. External Listing Images remain while the
Listing is active, receive a 30-day grace period after withdrawal, and are then deleted when no
published or reviewed record references their assets. Original URLs, hashes, dimensions,
processing outcomes, and decision history remain as evidence.

## Safety and retention

- HTTP and browser fetching must prevent private, loopback, link-local, metadata-service, and
  DNS-rebinding access, including subresources and every redirect hop.
- Only the exact approved Source host is in scope. A subdomain requires its own Source review.
- Phone-like content is redacted from retained snapshots, field evidence, and LLM inputs.
- Sanitized HTML snapshots and review screenshots expire after 30 days. Extracted values, evidence
  summaries, hashes, profile versions, decisions, and counters remain auditable.
- Pipeline work runs outside web requests with bounded concurrency, idempotency, timeouts, and
  limited retries. Retries never invoke an LLM.

## Minimal interfaces

The existing Source Proposal page remains the Submitter intake. The existing Operator Source
Proposal page becomes one staged case view for URL validation, Discovery progress, profile samples,
profile diffs, manual or explicit LLM repair, and the final decision. The existing External Listing
candidate cards handle exceptions.

The Submitter dashboard shows Source Assignment state, active profile review mode, recent
Extraction Runs, and counts for discovered, extracted, published, needs attention, rejected, and
failed results. Operators see the same information per assigned representative. Detailed fetch
artifacts remain inside the relevant review case rather than becoming a separate control center.

## Reuse from TorobTest

Port the normalization, page classification and scoring, deterministic observers, evidence and
conflict resolution, declarative rule executor, structural fingerprinting, profile validation,
drift detection, phone redaction, and their tests as framework-independent extraction code.

Adapt discovery, browser fetching, orchestration, snapshots, profile persistence, and model-call
auditing behind Django services, models, and Celery tasks. Do not port the FastAPI routes, SQLite
database layer, synchronous run lifecycle, or unrestricted prototype networking.

## Delivery slices

1. Port and harden the pure discovery and extraction engine, then replace the simulated preview
   with an asynchronous, URL-gated Discovery result.
2. Add Source Assignment, versioned Source Profile, reservation, and the staged Operator review.
3. Add Extraction Request and Run persistence, real candidate creation, canonical-URL updates,
   batch approval, and automatic-mode exception routing.
4. Generalize the existing image processor, add candidate-owned media staging, and promote accepted
   variants into Listing and reviewed Property images.
5. Add the small Submitter and Operator run summaries and remove the simulated-candidate path after
   migration tests cover the real workflow.
