from typing import cast

from django.contrib import admin
from django.db.models import QuerySet
from django.http import HttpRequest
from django.utils import timezone

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User

from .models import SupportRequest, SupportRequestStatus
from .selectors import (
    operator_has_required_support_capability,
    support_request_requires_privacy_capability,
    support_requests_visible_to,
)


def _has_support_access(user: User) -> bool:
    return has_capability(user, OperatorCapability.HANDLE_SUPPORT) or has_capability(
        user, OperatorCapability.HANDLE_PRIVACY_REQUESTS
    )


def _may_access_support_request(*, user: User, obj: SupportRequest | None) -> bool:
    if user.is_superuser:
        return True
    if not _has_support_access(user):
        return False
    if obj is not None and not operator_has_required_support_capability(
        support_request=obj, operator=user
    ):
        return False
    return not (
        obj is not None
        and support_request_requires_privacy_capability(obj)
        and not has_capability(user, OperatorCapability.HANDLE_PRIVACY_REQUESTS)
    )


@admin.register(SupportRequest)
class SupportRequestAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = (
        "name",
        "intake_kind",
        "classification",
        "priority",
        "priority_locked",
        "status",
        "assignee",
        "assigned_at",
        "created_at",
        "resolved_at",
    )
    list_filter = ("intake_kind", "classification", "priority", "status", "created_at")
    search_fields = ("name", "email", "message", "submitter__email")
    fields = (
        "id",
        "submitter",
        "name",
        "email",
        "intake_kind",
        "message",
        "classification",
        "priority",
        "priority_locked",
        "status",
        "escalation_destination",
        "required_capability",
        "operator_note",
        "assignee",
        "assigned_at",
        "resolved_by",
        "resolved_at",
        "created_at",
        "updated_at",
    )
    readonly_fields = (
        "id",
        "submitter",
        "name",
        "email",
        "message",
        "intake_kind",
        "classification",
        "priority",
        "priority_locked",
        "escalation_destination",
        "required_capability",
        "assignee",
        "assigned_at",
        "resolved_by",
        "resolved_at",
        "created_at",
        "updated_at",
    )

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def get_queryset(self, request: HttpRequest) -> QuerySet[SupportRequest]:
        queryset = super().get_queryset(request)
        user = cast(User, request.user)
        if user.is_superuser:
            return queryset
        if not _has_support_access(user):
            return queryset.none()
        visible_ids = support_requests_visible_to(operator=user).values("id")
        return queryset.filter(id__in=visible_ids)

    def has_view_permission(
        self,
        request: HttpRequest,
        obj: SupportRequest | None = None,
    ) -> bool:
        if not super().has_view_permission(request, obj):
            return False
        return _may_access_support_request(user=cast(User, request.user), obj=obj)

    def has_change_permission(
        self,
        request: HttpRequest,
        obj: SupportRequest | None = None,
    ) -> bool:
        if not super().has_change_permission(request, obj):
            return False
        return _may_access_support_request(user=cast(User, request.user), obj=obj)

    def has_delete_permission(
        self, request: HttpRequest, obj: SupportRequest | None = None
    ) -> bool:
        return False

    def save_model(
        self,
        request: HttpRequest,
        obj: SupportRequest,
        form: object,
        change: bool,
    ) -> None:
        if obj.status == SupportRequestStatus.RESOLVED and obj.resolved_at is None:
            obj.resolved_at = timezone.now()
            obj.resolved_by = cast(User, request.user)
        elif obj.status != SupportRequestStatus.RESOLVED:
            obj.resolved_at = None
            obj.resolved_by = None
        super().save_model(request, obj, form, change)
