import pytest


@pytest.mark.django_db
def test_image_cleanup_batches_make_progress_past_retained_images(discovered_case):
    from datetime import timedelta

    from django.utils import timezone

    from apps.source_proposals.media_retention import cleanup_external_images
    from apps.source_proposals.models import CandidateImage, ExternalListingCandidate

    proposal = discovered_case[0]
    proposal.refresh_from_db()
    candidate = ExternalListingCandidate.objects.create(
        source_proposal=proposal,
        source=proposal.source,
        title="Result",
        external_url="https://khaneh.example/listing/image-retention",
    )
    recent = CandidateImage.objects.create(candidate=candidate, source_order=0, position=0)
    expired = CandidateImage.objects.create(
        candidate=candidate,
        source_order=1,
        position=1,
        unreferenced_at=timezone.now() - timedelta(days=31),
    )
    assert cleanup_external_images(batch_size=1) == 0
    assert cleanup_external_images(batch_size=1) == 1
    recent.refresh_from_db()
    expired.refresh_from_db()
    assert recent.state == "pending"
    assert expired.state == "retired"
    assert cleanup_external_images(batch_size=1) == 0
