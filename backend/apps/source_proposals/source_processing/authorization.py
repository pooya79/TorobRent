"""Current Source Assignment and Source Profile authority for extraction work."""

from apps.accounts.models import User
from apps.catalog.models import Source

from ..models import ExtractionRequest, SourceAssignment, SourceProfile


def assignment_can_submit(
    *, assignment: SourceAssignment, source: Source, actor: User, proposal_id: str
) -> bool:
    return (
        not source.processing_paused
        and assignment.representative_id == actor.pk
        and str(assignment.proposal_id) == str(proposal_id)
        and assignment.revoked_at is None
        and assignment.approval is not None
        and source.profile.active_version_id == assignment.approval.version_id
    )


def authorized(request: ExtractionRequest) -> bool:
    return (
        request.requester_id is not None
        and SourceAssignment.objects.filter(
            pk=request.assignment_id,
            revoked_at__isnull=True,
            source__processing_paused=False,
            source__processing_revision=request.processing_revision,
            representative_id=request.requester_id,
            approval__version_id=request.profile_version_id,
        ).exists()
        and SourceProfile.objects.filter(
            source_id=request.assignment.source_id, active_version_id=request.profile_version_id
        ).exists()
    )


def authorization_error() -> dict[str, object]:
    return {
        "code": "authorization_ended",
        "detail": "تخصیص یا پروفایل تغییر کرده است.",
        "transient": False,
    }
