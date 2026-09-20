import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.common.development_seed import DevelopmentFixtureKind, development_fixture_id
from apps.submissions.models import Submission, SubmissionState


@pytest.mark.django_db
@pytest.mark.parametrize("legacy", [False, True])
def test_seeded_pending_submission_can_be_approved(legacy):
    call_command("seed_dev", verbosity=0)
    submission = Submission.objects.get(
        id=development_fixture_id(DevelopmentFixtureKind.SUBMISSION, 2)
    )
    if legacy:
        submission.images.all().delete()
        submission.review_data = {"development_seed": True}
        submission.save(update_fields=("review_data",))
        call_command("seed_dev", verbosity=0)

    client = APIClient()
    client.force_authenticate(User.objects.get(email="reviewer@torobrent.local"))
    url = f"/api/v1/operator/submissions/{submission.pk}"
    claim = client.post(f"{url}/claim/", {}, format="json")
    assert claim.status_code == 201, claim.data
    response = client.post(
        f"{url}/approve/", {"reviewed_revision": submission.revision}, format="json"
    )
    assert response.status_code == 200, response.data
    submission.refresh_from_db()
    assert submission.state == SubmissionState.PUBLISHED
    assert submission.listing.images.filter(is_primary=True).exists()
    assert submission.listing.images.get(is_primary=True).variants.count() == 3


@pytest.mark.django_db
def test_seed_preserves_explicitly_unconfirmed_submission():
    call_command("seed_dev", verbosity=0)
    submission = Submission.objects.get(
        id=development_fixture_id(DevelopmentFixtureKind.SUBMISSION, 2)
    )
    submission.review_data = {"development_seed": True, "accuracy_confirmed": False}
    submission.save(update_fields=("review_data",))

    call_command("seed_dev", verbosity=0)

    submission.refresh_from_db()
    assert submission.review_data == {"development_seed": True, "accuracy_confirmed": False}
