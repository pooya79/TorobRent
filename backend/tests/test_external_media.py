from io import BytesIO

import pytest
from PIL import Image

from apps.source_extraction.fetching import RawResponse
from tests.test_source_fetching import FakeTransport, public_resolver


def image_bytes(format="PNG"):
    output = BytesIO()
    Image.new("RGB", (40, 30), "red").save(output, format=format)
    return output.getvalue()


def test_image_fetches_only_twelve_https_images_and_revalidates_redirects():
    from apps.source_extraction.fetching import SourceImageFetcher

    start = "https://source.example/image"
    cdn = "https://cdn.example/image"
    transport = FakeTransport({
        start: RawResponse(302, {"Location": cdn}, b""),
        cdn: RawResponse(200, {}, image_bytes()),
    })
    fetcher = SourceImageFetcher(
        approved_hosts=("source.example", "cdn.example"),
        transport=transport,
        resolver=public_resolver,
    )
    batch = fetcher.fetch([start] * 13)
    assert len([record for record in batch.records if record.page]) == 12
    assert batch.records[-1].failure.code == "page_limit"
    assert all(request.port == 443 for request in transport.requests)
    assert (
        fetcher.fetch(["http://source.example/image"]).records[0].failure.code == "invalid_scheme"
    )
    transport.responses[cdn] = RawResponse(302, {"Location": "https://private.example/x"}, b"")
    assert fetcher.fetch([start]).records[0].failure.code == "host_not_approved"
    rebinding = SourceImageFetcher(
        approved_hosts=("source.example", "cdn.example"),
        transport=transport,
        resolver=lambda host, port: ["127.0.0.1"] if host == "cdn.example" else ["93.184.216.34"],
    )
    assert rebinding.fetch([start]).records[0].failure.code == "non_public_address"


@pytest.mark.django_db
def test_candidate_processing_retains_failures_and_first_valid_primary(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_proposals.candidate_serializers import ExternalListingCandidateSerializer
    from apps.source_proposals.external_media import stage_candidate_images
    from apps.source_proposals.models import ExternalListingCandidate
    from tests.test_extraction_publication import execute_run

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    candidate = ExternalListingCandidate.objects.get(pk=run["candidates"][0]["id"])
    bad, good = "https://khaneh.example/bad", "https://khaneh.example/good"
    transport = FakeTransport({
        bad: RawResponse(200, {}, b"not an image"),
        good: RawResponse(200, {}, image_bytes()),
    })
    stage_candidate_images(candidate, [bad, good], transport=transport, resolver=public_resolver)
    media = ExternalListingCandidateSerializer(candidate).data["media"]
    assert [item["state"] for item in media] == ["failed", "ready"]
    assert media[0]["failure_code"] == "processing_failed"
    assert media[1]["is_primary"] is True
    assert media[1]["original_url"] == good
    assert len(media[1]["content_hash"]) == 64
    assert len(media[1]["variants"]) == 3
    assert all(item["url"].startswith("/api/") for item in media[1]["variants"])
    assert candidate.validation_errors == {}


@pytest.mark.django_db
def test_review_reorders_excludes_and_explicitly_accepts_property_media(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_proposals.candidate_serializers import ExternalListingCandidateSerializer
    from apps.source_proposals.external_media import stage_candidate_images
    from apps.source_proposals.models import ExternalListingCandidate
    from tests.test_extraction_publication import execute_run

    bad_url = "https://khaneh.example/listing/10000"
    assigned_case[4].pages[bad_url] = (
        assigned_case[4].pages[bad_url].replace('class="area">85', 'class="area">95')
    )
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    candidate = ExternalListingCandidate.objects.get(
        pk=next(item["id"] for item in run["candidates"] if item["external_url"] == bad_url)
    )
    urls = [f"https://khaneh.example/{i}.png" for i in range(3)]
    stage_candidate_images(
        candidate,
        urls,
        transport=FakeTransport({url: RawResponse(200, {}, image_bytes()) for url in urls}),
        resolver=public_resolver,
    )
    media = ExternalListingCandidateSerializer(candidate).data["media"]
    thumbnail = media[0]["variants"][0]["url"]
    assert api_client.get(thumbnail).status_code == 200
    base = f"/api/v1/operator/external-listing-candidates/{candidate.pk}"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    choice = [
        {"id": media[2]["id"], "is_primary": True, "excluded": False, "accept_as_property": True},
        {"id": media[1]["id"], "is_primary": False, "excluded": True, "accept_as_property": False},
        {"id": media[0]["id"], "is_primary": False, "excluded": False, "accept_as_property": False},
    ]
    corrected = api_client.post(
        f"{base}/correct/",
        {
            "reviewed_revision": 1,
            "reason": "تصاویر بررسی شد",
            "values": {"area_sqm": 95},
            "media": choice,
        },
        format="json",
    )
    assert corrected.status_code == 200, corrected.data
    assert [item["id"] for item in corrected.data["media"]] == [item["id"] for item in choice]
    assert str(corrected.data["media"][0]["accepted_by"]) == str(assigned_case[2].pk)
    approved = api_client.post(
        f"{base}/approve/",
        {"reviewed_revision": corrected.data["revision"], "confirmed": True},
        format="json",
    )
    assert approved.status_code == 200, approved.data
    from apps.catalog.models import Listing

    listing = Listing.objects.get(pk=approved.data["listing_id"])
    api_client.force_authenticate(None)
    detail = api_client.get(f"/api/v1/catalog/properties/{listing.property_id}/")
    assert detail.status_code == 200, detail.data
    assert (
        api_client
        .get("/api/v1/catalog/properties/")
        .data["results"][0]["primary_image"]["url"]
        .startswith("/api/v1/catalog/media/")
    )
    public_listing = next(
        item for item in detail.data["listings"] if str(item["id"]) == str(listing.pk)
    )
    assert len(public_listing["images"]) == 2
    assert public_listing["media_url"].startswith("/api/v1/catalog/media/")
    assert api_client.get(public_listing["media_url"]).status_code == 200
    assert api_client.get(thumbnail).status_code in (401, 403)
    assert listing.property.images.count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize("image_path", ["broken.png", "x" * 2100], ids=["normal-url", "long-url"])
def test_extraction_downloads_images_and_reports_optional_failures(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, image_path
):
    from apps.source_extraction.fetching import PinnedHttpTransport
    from tests.test_extraction_publication import execute_run

    url = "https://khaneh.example/listing/10000"
    assigned_case[4].pages[url] = (
        assigned_case[4]
        .pages[url]
        .replace(
            "</head>",
            f'<meta property="og:image" content="https://khaneh.example/{image_path}"></head>',
        )
    )
    monkeypatch.setattr(
        PinnedHttpTransport, "get", lambda self, request: RawResponse(200, {}, b"broken")
    )
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    candidate = next(item for item in run["candidates"] if item["external_url"] == url)
    assert len(candidate["media"]) == 1
    assert candidate["media"][0]["state"] == "failed"
    assert candidate["validation_errors"] == {}
    assert any(error["code"] == "image_processing_failed" for error in run["errors"])
    approved = api_client.post(
        f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/",
        {"reviewed_revision": run["revision"], "confirmed": True},
        format="json",
    )
    assert approved.status_code == 200
    assert approved.data["published"] == 10


@pytest.mark.django_db
def test_retention_keeps_active_and_reviewed_assets_and_retires_after_grace(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from datetime import timedelta

    from django.utils import timezone

    from apps.catalog.models import Listing, PropertyImage, PropertyImageVariant
    from apps.catalog.services import mark_listing_unavailable
    from apps.source_proposals.candidate_serializers import ExternalListingCandidateSerializer
    from apps.source_proposals.external_media import stage_candidate_images
    from apps.source_proposals.models import ExternalListingCandidate
    from apps.source_proposals.tasks import cleanup_external_images
    from tests.test_extraction_publication import execute_run

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    candidate = ExternalListingCandidate.objects.get(pk=run["candidates"][0]["id"])
    url = "https://khaneh.example/retained.png"
    stage_candidate_images(
        candidate,
        [url],
        transport=FakeTransport({url: RawResponse(200, {}, image_bytes())}),
        resolver=public_resolver,
    )
    approved = api_client.post(
        f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/",
        {"reviewed_revision": run["revision"], "confirmed": True},
        format="json",
    )
    assert approved.status_code == 200
    candidate.refresh_from_db()
    assert candidate.listing.property.images.count() == 0
    variant = candidate.images.first().variants.first()
    asset = variant.asset
    original_time = timezone.now()
    monkeypatch.setattr(timezone, "now", lambda: original_time + timedelta(days=20))
    assert cleanup_external_images() == 0
    reviewed = PropertyImage.objects.create(
        property=candidate.listing.property,
        position=0,
        reviewed_at=timezone.now(),
        reviewed_by=assigned_case[2],
    )
    PropertyImageVariant.objects.create(image=reviewed, kind=variant.kind, asset=asset)
    mark_listing_unavailable(Listing.objects.get(pk=candidate.listing_id))
    assert cleanup_external_images() == 0
    monkeypatch.setattr(timezone, "now", lambda: original_time + timedelta(days=49))
    assert cleanup_external_images() == 0
    monkeypatch.setattr(timezone, "now", lambda: original_time + timedelta(days=51))
    with django_capture_on_commit_callbacks(execute=True):
        cleanup_external_images()
    assert asset.file.storage.exists(asset.file.name)
    reviewed.delete()
    with django_capture_on_commit_callbacks(execute=True):
        cleanup_external_images()
    # A reviewed reference's removal starts its own conservative grace period.
    monkeypatch.setattr(timezone, "now", lambda: original_time + timedelta(days=82))
    with django_capture_on_commit_callbacks(execute=True):
        cleanup_external_images()
    media = ExternalListingCandidateSerializer(candidate).data["media"][0]
    assert media["state"] == "retired"
    assert media["content_hash"]
    assert media["original_url"] == url
    assert all(item["url"] is None and item["width"] > 0 for item in media["variants"])
    assert not asset.file.storage.exists(asset.file.name)


@pytest.mark.django_db
def test_discovery_stages_bounded_candidate_previews_after_url_approval(
    api_client, monkeypatch, request
):
    from apps.source_extraction.fetching import PinnedHttpTransport
    from tests import test_source_extraction_contract as fixtures

    original = fixtures.listing_html
    monkeypatch.setattr(
        fixtures,
        "listing_html",
        lambda **kw: original(**kw).replace(
            "</head>",
            '<meta property="og:image" content="https://khaneh.example/preview.png"></head>',
        ),
    )
    downloads = []

    def download(self, request):
        downloads.append(request.url)
        return RawResponse(200, {}, image_bytes())

    monkeypatch.setattr(PinnedHttpTransport, "get", download)
    monkeypatch.setattr("apps.source_extraction.fetching.resolve_addresses", public_resolver)
    proposal, base, operator, representative, fetcher = request.getfixturevalue("discovered_case")
    case = api_client.get("/api/v1/operator/source-proposals/").data[0]
    previews = case["profile_versions"][0]["media_candidates"]
    assert 0 < len(downloads) <= 12
    assert previews[0]["media"][0]["state"] == "ready"
    assert api_client.get(previews[0]["media"][0]["variants"][0]["url"]).status_code == 200
    assert api_client.get("/api/v1/operator/external-listing-candidates/").data == []
    assert (
        api_client.post(
            f"/api/v1/operator/external-listing-candidates/{previews[0]['id']}/claim/", {}
        ).status_code
        == 400
    )


@pytest.mark.django_db
def test_media_storage_failure_cannot_rollback_an_automatic_listing(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from django.core.files.storage import default_storage

    from apps.source_extraction.fetching import PinnedHttpTransport
    from tests.test_extraction_publication import execute_run

    url = "https://khaneh.example/listing/10000"
    assigned_case[4].pages[url] = (
        assigned_case[4]
        .pages[url]
        .replace(
            "</head>",
            '<meta property="og:image" content="https://khaneh.example/image.png"></head>',
        )
    )
    monkeypatch.setattr(
        PinnedHttpTransport, "get", lambda self, request: RawResponse(200, {}, image_bytes())
    )

    def failed_storage(*args, **kwargs):
        raise RuntimeError("storage unavailable")

    monkeypatch.setattr(default_storage, "save", failed_storage)
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert run["state"] == "complete"
    assert len(run["candidates"]) == 10
    assert any(error["code"] == "image_processing_failed" for error in run["errors"])


def test_image_fetch_limits_bytes_and_the_entire_redirect_deadline(monkeypatch):
    import apps.source_extraction.fetching as fetching
    from apps.source_extraction.fetching import SourceImageFetcher

    url = "https://source.example/a"
    transport = FakeTransport({url: RawResponse(200, {}, b"x" * (10 * 1024 * 1024 + 1))})
    fetcher = SourceImageFetcher(
        approved_hosts=["source.example"], transport=transport, resolver=public_resolver
    )
    assert fetcher.fetch([url]).records[0].failure.code == "response_too_large"
    clock = [100.0]
    monkeypatch.setattr(fetching.time, "monotonic", lambda: clock[0])
    requests = []

    def redirect(request):
        requests.append(request)
        clock[0] += 8
        return RawResponse(302, {"Location": url}, b"")

    transport.get = redirect
    assert fetcher.fetch([url]).records[0].failure.code == "timeout"
    assert len(requests) == 2


@pytest.mark.django_db
def test_discovery_media_redelivery_is_idempotent_and_new_versions_keep_new_evidence(
    api_client, monkeypatch, request
):
    from copy import deepcopy

    from django.utils import timezone

    from apps.source_extraction.fetching import PinnedHttpTransport
    from apps.source_proposals.models import SourceProfileVersion, SourceReservation
    from apps.source_proposals.tasks import process_discovery_images
    from tests import test_source_extraction_contract as fixtures

    original = fixtures.listing_html
    monkeypatch.setattr(
        fixtures,
        "listing_html",
        lambda **kw: original(**kw).replace(
            "</head>", '<meta property="og:image" content="https://khaneh.example/old.png"></head>'
        ),
    )
    downloads = []

    def download(self, request):
        downloads.append(request.url)
        return RawResponse(200, {}, image_bytes())

    monkeypatch.setattr(PinnedHttpTransport, "get", download)
    monkeypatch.setattr("apps.source_extraction.fetching.resolve_addresses", public_resolver)
    proposal = request.getfixturevalue("discovered_case")[0]
    reservation = proposal.reservations.get()
    count = len(downloads)
    process_discovery_images(str(reservation.pk))
    assert len(downloads) == count
    old = reservation.profile_versions.first()
    samples = deepcopy(old.samples)
    for sample in samples:
        sample["normalized"]["image_urls"] = ["https://khaneh.example/new.png"]
    reservation.released_at = timezone.now()
    reservation.save(update_fields=("released_at",))
    reservation = SourceReservation.objects.create(
        source=reservation.source,
        proposal=proposal,
        revision=proposal.revision,
        approved_url=reservation.approved_url,
        expires_at=reservation.expires_at,
    )
    SourceProfileVersion.objects.create(
        profile=old.profile,
        reservation=reservation,
        parent=old,
        number=old.number + 1,
        samples=samples,
        rules=old.rules,
        structural_fingerprint=old.structural_fingerprint,
        validation=old.validation,
        exclusions=old.exclusions,
        pipeline_version=old.pipeline_version,
        provenance="discovery",
    )
    process_discovery_images(str(reservation.pk))
    versions = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"]
    assert (
        versions[0]["media_candidates"][0]["media"][0]["original_url"]
        == "https://khaneh.example/new.png"
    )
    assert (
        versions[1]["media_candidates"][0]["media"][0]["original_url"]
        == "https://khaneh.example/old.png"
    )
    assert len(downloads) == count * 2
