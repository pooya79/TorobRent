from typing import Any, cast

from django.contrib import admin
from django.http import HttpRequest
from unfold.admin import ModelAdmin

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User

from .models import SourceImageHost, SourceProposal


@admin.register(SourceProposal)
class SourceProposalAdmin(ModelAdmin):  # type: ignore[type-arg]
    list_display = (
        "website_name",
        "normalized_domain",
        "submitter",
        "state",
        "needs_reconciliation",
        "updated_at",
    )
    list_filter = ("state", "relationship", "inventory_range", "needs_reconciliation")
    search_fields = ("website_name", "normalized_domain", "submitter__email", "submitter__phone")
    readonly_fields = (
        "id",
        "normalized_domain",
        "needs_reconciliation",
        "pending_since",
        "created_at",
        "updated_at",
    )


@admin.register(SourceImageHost)
class SourceImageHostAdmin(ModelAdmin):  # type: ignore[type-arg]
    list_display = ("source", "host", "approved_by", "approved_at", "revoked_at")
    readonly_fields = ("approved_by", "approved_at")

    def has_add_permission(self, request: HttpRequest) -> bool:
        return super().has_add_permission(request) and has_capability(
            cast(User, request.user), OperatorCapability.REVIEW_SOURCE_PROPOSALS
        )

    def has_change_permission(
        self, request: HttpRequest, obj: SourceImageHost | None = None
    ) -> bool:
        return super().has_change_permission(request, obj) and has_capability(
            cast(User, request.user), OperatorCapability.REVIEW_SOURCE_PROPOSALS
        )

    def has_delete_permission(
        self, request: HttpRequest, obj: SourceImageHost | None = None
    ) -> bool:
        return False

    def get_readonly_fields(
        self, request: HttpRequest, obj: SourceImageHost | None = None
    ) -> tuple[str, ...]:
        return (*self.readonly_fields, "source", "host") if obj else self.readonly_fields

    def save_model(
        self, request: HttpRequest, obj: SourceImageHost, form: Any, change: bool
    ) -> None:
        if not change:
            obj.approved_by = cast(User, request.user)
        super().save_model(request, obj, form, change)
