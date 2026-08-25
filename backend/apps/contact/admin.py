from typing import cast

from django.contrib import admin
from django.http import HttpRequest
from django.utils import timezone

from apps.accounts.models import User

from .models import SupportRequest, SupportRequestStatus


@admin.register(SupportRequest)
class SupportRequestAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = (
        "name",
        "intake_kind",
        "classification",
        "status",
        "assignee",
        "assigned_at",
        "created_at",
        "resolved_at",
    )
    list_filter = ("intake_kind", "classification", "status", "created_at")
    search_fields = ("name", "email", "message", "submitter__email")
    fields = (
        "id",
        "submitter",
        "name",
        "email",
        "intake_kind",
        "message",
        "classification",
        "status",
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
        "assignee",
        "assigned_at",
        "resolved_by",
        "resolved_at",
        "created_at",
        "updated_at",
    )

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

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
