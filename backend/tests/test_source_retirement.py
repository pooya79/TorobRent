import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("state", ["pending", "published"])
def test_retirement_preserves_historical_candidates_and_decisions(state):
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    old = [("source_proposals", "0021_alter_candidateimage_original_url")]
    target = [("source_proposals", "0022_retire_simulation")]
    try:
        executor.migrate(old)
        apps = executor.loader.project_state(old).apps
        source = apps.get_model("catalog", "Source").objects.create(
            name="legacy", domain="legacy.example"
        )
        proposal = apps.get_model("source_proposals", "SourceProposal").objects.create(
            source=source, preview={"simulated": True, "examples": [{"title": "old"}]}
        )
        Candidate = apps.get_model("source_proposals", "ExternalListingCandidate")
        candidate = Candidate.objects.create(
            source_proposal=proposal,
            source=source,
            title="Historical sample",
            external_url="https://legacy.example/sample",
            simulated=True,
            state=state,
        )
        real = Candidate.objects.create(
            source_proposal=proposal,
            source=source,
            title="Real result",
            external_url="https://legacy.example/real",
            simulated=False,
        )
        listing = None
        if state == "published":
            property = apps.get_model("catalog", "Property").objects.create()
            terms = apps.get_model("catalog", "RentalTerms").objects.create(
                deposit_rial=1_000_000, monthly_rent_rial=0
            )
            listing = apps.get_model("catalog", "Listing").objects.create(
                source=source,
                property=property,
                terms=terms,
                state="published",
                source_reference=str(candidate.pk),
                external_url=candidate.external_url,
            )
            candidate.listing = listing
            candidate.save()
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        apps = executor.loader.project_state(target).apps
        Candidate = apps.get_model("source_proposals", "ExternalListingCandidate")
        retained = Candidate.objects.get(pk=candidate.pk)
        assert retained.state == "cancelled"
        assert retained.evidence["legacy_simulation"] is True
        assert retained.title == "Historical sample"
        assert retained.events.get().prior_state == state
        assert retained.events.get().new_state == "cancelled"
        assert Candidate.objects.get(pk=real.pk).state == "pending"
        if listing:
            listing.refresh_from_db()
            assert listing.state == "unavailable"
            assert retained.listing_id == listing.pk
        # New code can insert while the compatibility column still exists.
        Candidate.objects.create(
            source_proposal_id=proposal.pk,
            source_id=source.pk,
            title="New result",
            external_url="https://legacy.example/new",
        )
    finally:
        MigrationExecutor(connection).migrate(latest)


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
