from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import SourceProposal


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
