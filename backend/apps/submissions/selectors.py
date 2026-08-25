from datetime import timedelta

from django.db.models import F, Q, QuerySet
from django.utils import timezone

from apps.accounts.models import User

from .models import Submission, SubmissionState

OPERATOR_AGING_AFTER = timedelta(hours=48)


def submissions_reviewable_by(*, operator: User) -> QuerySet[Submission]:
    """Return Submissions the Operator may review, excluding their own work."""
    return Submission.objects.exclude(submitter=operator)


def submission_workload_summary(*, operator: User) -> dict[str, int]:
    from .services import release_unavailable_review_claims

    release_unavailable_review_claims()
    actionable = submissions_reviewable_by(operator=operator).filter(state=SubmissionState.PENDING)
    active_claim = Q(
        review_claims__released_at__isnull=True,
        review_claims__revision=F("revision"),
        review_claims__expires_at__gt=timezone.now(),
    )
    return {
        "unclaimed_count": actionable.exclude(active_claim).distinct().count(),
        "assigned_to_me_count": actionable
        .filter(active_claim, review_claims__operator=operator)
        .distinct()
        .count(),
        "aging_count": actionable.filter(
            pending_since__lte=timezone.now() - OPERATOR_AGING_AFTER
        ).count(),
        "aging_after_hours": int(OPERATOR_AGING_AFTER.total_seconds() // 3600),
    }
