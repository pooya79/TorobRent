from django.contrib import admin
from django.db.models import QuerySet
from django.http import HttpRequest
from unfold.admin import ModelAdmin

from .models import SourceConversationMessage
from .source_conversations import redact_source_message


@admin.register(SourceConversationMessage)
class SourceConversationMessageAdmin(ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "conversation", "created_at", "redacted_at")
    readonly_fields = (
        "id",
        "conversation",
        "author",
        "from_representative",
        "body",
        "created_at",
        "redacted_at",
        "redacted_by",
    )
    actions = ("redact_personal_content",)

    def has_view_permission(
        self, request: HttpRequest, obj: SourceConversationMessage | None = None
    ) -> bool:
        return request.user.is_superuser

    def has_change_permission(
        self, request: HttpRequest, obj: SourceConversationMessage | None = None
    ) -> bool:
        return request.user.is_superuser

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_delete_permission(
        self, request: HttpRequest, obj: SourceConversationMessage | None = None
    ) -> bool:
        return False

    @admin.action(description="Redact personal message content (retains operational history)")
    def redact_personal_content(
        self, request: HttpRequest, queryset: QuerySet[SourceConversationMessage]
    ) -> None:
        from typing import cast

        from apps.accounts.models import User

        for message in queryset:
            redact_source_message(message_id=message.pk, actor=cast(User, request.user))
