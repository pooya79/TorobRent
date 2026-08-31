from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class SourceProposalState(models.TextChoices):
    DRAFT = "draft", "پیش‌نویس"
    PENDING = "pending", "در انتظار بررسی"


class SourceProposalStep(models.TextChoices):
    DETAILS = "details", "اطلاعات وب‌سایت"
    PREVIEW = "preview", "پیش‌نمایش شبیه‌سازی‌شده"


class SourceRepresentativeRelationship(models.TextChoices):
    WEBSITE_OWNER = "website_owner", "مالک وب‌سایت"
    MANAGER = "website_manager", "مدیر وب‌سایت"
    AUTHORIZED_REPRESENTATIVE = "authorized_representative", "نماینده مجاز"


class InventoryRange(models.TextChoices):
    ONE_TO_TEN = "1_10", "۱ تا ۱۰"
    ELEVEN_TO_FIFTY = "11_50", "۱۱ تا ۵۰"
    FIFTY_ONE_TO_TWO_HUNDRED = "51_200", "۵۱ تا ۲۰۰"
    MORE_THAN_TWO_HUNDRED = "more_than_200", "بیش از ۲۰۰"
    UNKNOWN = "unknown", "نمی‌دانم"


class SourceProposal(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submitter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="source_proposals",
    )
    state = models.CharField(
        max_length=16, choices=SourceProposalState, default=SourceProposalState.DRAFT
    )
    current_step = models.CharField(
        max_length=16, choices=SourceProposalStep, default=SourceProposalStep.DETAILS
    )
    website_name = models.CharField(max_length=200, blank=True)
    website_url = models.URLField(max_length=1000, blank=True)
    normalized_domain = models.CharField(max_length=253, blank=True, db_index=True)
    relationship = models.CharField(
        max_length=32, choices=SourceRepresentativeRelationship, blank=True
    )
    inventory_range = models.CharField(max_length=24, choices=InventoryRange, blank=True)
    sitemap_url = models.URLField(max_length=1000, blank=True)
    operator_note = models.TextField(max_length=5000, blank=True)
    authority_declared = models.BooleanField(default=False)
    preview = models.JSONField(default=dict, blank=True)
    preview_confirmed = models.BooleanField(default=False)
    needs_reconciliation = models.BooleanField(default=False, editable=False)
    pending_since = models.DateTimeField(null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("submitter", "normalized_domain"),
                condition=models.Q(
                    state__in=(SourceProposalState.DRAFT, SourceProposalState.PENDING)
                )
                & ~models.Q(normalized_domain=""),
                name="one_open_source_proposal_per_account_domain",
            )
        ]

    def __str__(self) -> str:
        return self.website_name or f"Source Proposal {self.id}"
