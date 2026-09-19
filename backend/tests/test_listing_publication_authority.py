import uuid

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction

from apps.catalog.models import Listing, RentalTerms, Source
from apps.catalog.services import confirm_listing_availability, publish_listing
from apps.source_proposals.models import SourceAssignment
from apps.submissions.models import Submission


@pytest.fixture
def seeded_listing():
    call_command("seed_dev", verbosity=0)
    return Listing.objects.filter(
        source__outbound_policy="external_link", state="published"
    ).first()


@pytest.mark.django_db
def test_database_rejects_unapproved_external_publication_and_source_change(seeded_listing):
    orphan = Source.objects.create(
        name="unapproved", domain="unapproved.invalid", outbound_policy="external_link"
    )
    with pytest.raises(IntegrityError, match="approved Source Assignment"), transaction.atomic():
        Listing.objects.filter(pk=seeded_listing.pk).update(source=orphan)
    seeded_listing.pk = uuid.uuid4()
    seeded_listing.source = orphan
    seeded_listing.terms = RentalTerms.objects.create(deposit_rial=100, monthly_rent_rial=100)
    with pytest.raises(IntegrityError, match="approved Source Assignment"), transaction.atomic():
        Listing.objects.bulk_create([seeded_listing])
    seeded_listing.state = "draft"
    seeded_listing.save(force_insert=True)
    with pytest.raises(IntegrityError, match="approved Source Assignment"), transaction.atomic():
        Listing.objects.filter(pk=seeded_listing.pk).update(state="published")
    with pytest.raises(ValidationError, match="approved Source Assignment"):
        publish_listing(seeded_listing)
    Listing.objects.filter(pk=seeded_listing.pk).update(state="expired")
    with pytest.raises(ValidationError, match="approved Source Assignment"):
        confirm_listing_availability(seeded_listing)


@pytest.mark.django_db
def test_database_rejects_external_source_or_listing_on_direct_submission(seeded_listing):
    submission = Submission.objects.filter(listing__isnull=True).first()
    for values in ({"source": seeded_listing.source}, {"listing": seeded_listing}):
        with pytest.raises(IntegrityError, match="Submission"), transaction.atomic():
            Submission.objects.filter(pk=submission.pk).update(**values)
    direct = Listing.objects.filter(submission__isnull=False).first()
    with pytest.raises(IntegrityError), transaction.atomic():
        Listing.objects.filter(pk=direct.pk).update(source=seeded_listing.source)


@pytest.mark.django_db
def test_approval_pointer_alone_is_not_enough(seeded_listing):
    assignment = SourceAssignment.objects.get(source=seeded_listing.source, revoked_at=None)
    other = SourceAssignment.objects.exclude(pk=assignment.pk).get()
    approval = assignment.approval
    assignment.approval = None
    assignment.save(update_fields=("approval",))
    with pytest.raises(IntegrityError, match="approved Source Assignment"), transaction.atomic():
        Listing.objects.filter(pk=seeded_listing.pk).update(state="published")
    assignment.representative = other.representative
    assignment.approval = approval
    assignment.save(update_fields=("representative", "approval"))
    with pytest.raises(IntegrityError, match="approved Source Assignment"), transaction.atomic():
        Listing.objects.filter(pk=seeded_listing.pk).update(state="published")


@pytest.mark.django_db
def test_changing_source_policy_cannot_bypass_direct_submission_guard(seeded_listing):
    direct_source = Source.objects.get(is_builtin=True)
    with pytest.raises(IntegrityError, match="External Source"), transaction.atomic():
        Source.objects.filter(pk=direct_source.pk).update(outbound_policy="external_link")


@pytest.mark.django_db
def test_revocation_preserves_history_withdraws_seed_listings_and_survives_reseed(seeded_listing):
    from apps.source_proposals.assignments import revoke_assignment

    assignment = SourceAssignment.objects.get(source=seeded_listing.source, revoked_at=None)
    proposal = assignment.proposal
    revoke_assignment(
        proposal=proposal,
        actor=assignment.source.responsible_operator,
        reviewed_revision=proposal.revision,
        reason="Development revocation test",
    )
    call_command("seed_dev", verbosity=0)
    assignment.refresh_from_db()
    assert assignment.revoked_at is not None
    assert not Listing.objects.filter(source=assignment.source, state="published").exists()
    assert Listing.objects.filter(source=assignment.source).exists()
    with pytest.raises(IntegrityError, match="approved Source Assignment"), transaction.atomic():
        Listing.objects.filter(pk=seeded_listing.pk).update(state="published")
