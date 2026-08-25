from django.db.models import QuerySet

from apps.accounts.models import User

from .models import Submission


def submissions_reviewable_by(*, operator: User) -> QuerySet[Submission]:
    """Return Submissions the Operator may review, excluding their own work."""
    return Submission.objects.exclude(submitter=operator)
