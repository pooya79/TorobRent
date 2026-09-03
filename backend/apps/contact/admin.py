from typing import cast

from django.contrib import admin
from django.db.models import QuerySet
from django.http import HttpRequest
from unfold.admin import ModelAdmin

from apps.accounts.models import User

from .models import SupportRequest
from .services import redact_support_request_content


@admin.register(SupportRequest)
class SupportRequestAdmin(ModelAdmin):  # type: ignore[type-arg]
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
        "account_linked_at_intake",
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
        "resolution_category",
        "resolution_summary",
        "personal_content_redacted_at",
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
        "account_linked_at_intake",
        "classification",
        "priority",
        "priority_locked",
        "status",
        "escalation_destination",
        "required_capability",
        "assignee",
        "assigned_at",
        "resolved_by",
        "resolved_at",
        "resolution_category",
        "resolution_summary",
        "operator_note",
        "personal_content_redacted_at",
        "created_at",
        "updated_at",
    )
    actions = ("redact_selected_personal_content",)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def get_queryset(self, request: HttpRequest) -> QuerySet[SupportRequest]:
        queryset = super().get_queryset(request)
        return queryset if request.user.is_superuser else queryset.none()

    def has_module_permission(self, request: HttpRequest) -> bool:
        return request.user.is_superuser and super().has_module_permission(request)

    def has_view_permission(
        self,
        request: HttpRequest,
        obj: SupportRequest | None = None,
    ) -> bool:
        if not super().has_view_permission(request, obj):
            return False
        return request.user.is_superuser

    def has_change_permission(
        self,
        request: HttpRequest,
        obj: SupportRequest | None = None,
    ) -> bool:
        if not super().has_change_permission(request, obj):
            return False
        return request.user.is_superuser

    def has_delete_permission(
        self, request: HttpRequest, obj: SupportRequest | None = None
    ) -> bool:
        return False

    @admin.action(description="Redact selected personal Support Request content")
    def redact_selected_personal_content(
        self,
        request: HttpRequest,
        queryset: QuerySet[SupportRequest],
    ) -> None:
        actor = cast(User, request.user)
        if not actor.is_superuser:
            self.message_user(
                request,
                "Only superusers may redact personal Support Request content.",
                level="error",
            )
            return
        redacted = 0
        for support_request in queryset:
            if support_request.personal_content_redacted_at is not None:
                continue
            redact_support_request_content(
                support_request=support_request,
                actor=actor,
            )
            redacted += 1
        self.message_user(request, f"Redacted {redacted} Support Request(s).")
