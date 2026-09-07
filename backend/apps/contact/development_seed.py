from dataclasses import dataclass

from django.utils import timezone

from apps.accounts.models import User
from apps.common.development_seed import DevelopmentFixtureKind, development_fixture_id

from .models import (
    IntakeKind,
    SupportClassification,
    SupportMessage,
    SupportMessageAuthor,
    SupportPriority,
    SupportRequest,
    SupportRequestEvent,
    SupportRequestEventType,
    SupportRequestStatus,
    SupportResolutionCategory,
)


@dataclass(frozen=True)
class DevelopmentSupportResult:
    requests: int
    messages: int


@dataclass(frozen=True)
class DevelopmentSupportSpec:
    subject: str
    intake_kind: IntakeKind
    classification: SupportClassification
    priority: SupportPriority
    status: SupportRequestStatus


def seed_development_support_requests(
    *, submitter: User, support_operator: User
) -> DevelopmentSupportResult:
    specs = (
        DevelopmentSupportSpec(
            "راهنمای تکمیل پیشنهاد",
            IntakeKind.GENERAL,
            SupportClassification.UNCLASSIFIED,
            SupportPriority.NORMAL,
            SupportRequestStatus.OPEN,
        ),
        DevelopmentSupportSpec(
            "اصلاح شماره تماس",
            IntakeKind.GENERAL,
            SupportClassification.GUIDANCE,
            SupportPriority.NORMAL,
            SupportRequestStatus.IN_PROGRESS,
        ),
        DevelopmentSupportSpec(
            "حذف اطلاعات تماس عمومی",
            IntakeKind.PUBLIC_CONTACT_REMOVAL,
            SupportClassification.PRIVACY,
            SupportPriority.URGENT,
            SupportRequestStatus.ESCALATED,
        ),
        DevelopmentSupportSpec(
            "پرسش درباره نتیجه بررسی",
            IntakeKind.GENERAL,
            SupportClassification.GUIDANCE,
            SupportPriority.NORMAL,
            SupportRequestStatus.RESOLVED,
        ),
    )
    request_ids = []
    for index, spec in enumerate(specs, start=1):
        assigned = spec.status in (
            SupportRequestStatus.IN_PROGRESS,
            SupportRequestStatus.RESOLVED,
        )
        resolved = spec.status == SupportRequestStatus.RESOLVED
        now = timezone.now()
        support_request, _created = SupportRequest.objects.get_or_create(
            id=development_fixture_id(DevelopmentFixtureKind.SUPPORT_REQUEST, index),
            defaults={
                "submitter": submitter,
                "name": submitter.display_name,
                "email": submitter.email or "",
                "intake_kind": spec.intake_kind,
                "subject": spec.subject,
                "message": "این یک درخواست ساختگی برای آزمایش گردش کار پشتیبانی است.",
                "requester_read_at": None if index in (2, 4) else now,
                "account_linked_at_intake": True,
                "classification": spec.classification,
                "priority": spec.priority,
                "priority_locked": spec.intake_kind == IntakeKind.PUBLIC_CONTACT_REMOVAL,
                "status": spec.status,
                "assignee": support_operator if assigned else None,
                "assigned_at": now if assigned else None,
                "resolved_by": support_operator if resolved else None,
                "resolved_at": now if resolved else None,
                "resolution_category": (
                    SupportResolutionCategory.ANSWERED_EXTERNALLY if resolved else None
                ),
                "resolution_summary": "راهنمایی لازم ارائه شد." if resolved else "",
            },
        )
        request_ids.append(support_request.id)
        bodies = ["این یک درخواست ساختگی برای آزمایش گردش کار پشتیبانی است."]
        if assigned:
            bodies.append("درخواست شما در حال بررسی است و نتیجه اعلام می شود.")
        for position, body in enumerate(bodies, start=1):
            author_kind = (
                SupportMessageAuthor.REQUESTER if position == 1 else SupportMessageAuthor.OPERATOR
            )
            SupportMessage.objects.get_or_create(
                id=development_fixture_id(
                    DevelopmentFixtureKind.SUPPORT_MESSAGE, index * 10 + position
                ),
                defaults={
                    "support_request": support_request,
                    "author": submitter if position == 1 else support_operator,
                    "author_kind": author_kind,
                    "is_initial": position == 1,
                    "body": body,
                },
            )
        if assigned:
            SupportRequestEvent.objects.get_or_create(
                id=development_fixture_id(DevelopmentFixtureKind.SUPPORT_EVENT, index * 10 + 1),
                defaults={
                    "support_request": support_request,
                    "actor": support_operator,
                    "event_type": SupportRequestEventType.ASSIGNED,
                    "prior_state": SupportRequestStatus.OPEN,
                    "new_state": SupportRequestStatus.IN_PROGRESS,
                    "classification": spec.classification,
                    "new_assignee": support_operator,
                },
            )
        if resolved:
            SupportRequestEvent.objects.get_or_create(
                id=development_fixture_id(DevelopmentFixtureKind.SUPPORT_EVENT, index * 10 + 2),
                defaults={
                    "support_request": support_request,
                    "actor": support_operator,
                    "event_type": SupportRequestEventType.RESOLVED,
                    "prior_state": SupportRequestStatus.IN_PROGRESS,
                    "new_state": SupportRequestStatus.RESOLVED,
                    "classification": spec.classification,
                    "resolution_category": SupportResolutionCategory.ANSWERED_EXTERNALLY,
                    "resolution_summary": "راهنمایی لازم ارائه شد.",
                },
            )
    return DevelopmentSupportResult(
        requests=SupportRequest.objects.filter(id__in=request_ids).count(),
        messages=SupportMessage.objects.filter(support_request_id__in=request_ids).count(),
    )
