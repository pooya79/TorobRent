from __future__ import annotations

import uuid
from typing import Any, ClassVar

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.catalog.models import PropertyType
from apps.common.deletion import set_null_in_immutable_history


class SourceProposalState(models.TextChoices):
    DRAFT = "draft", "پیش‌نویس"
    PENDING = "pending", "در انتظار بررسی"
    CHANGES_REQUESTED = "changes_requested", "نیازمند اصلاح"
    REJECTED = "rejected", "ردشده"
    APPROVED = "approved", "تأییدشده"


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
        on_delete=models.SET_NULL,
        related_name="source_proposals",
        null=True,
    )
    state = models.CharField(
        max_length=24, choices=SourceProposalState, default=SourceProposalState.DRAFT
    )
    revision = models.PositiveIntegerField(default=1, editable=False)
    source = models.ForeignKey(
        "catalog.Source",
        on_delete=models.PROTECT,
        related_name="source_proposals",
        null=True,
        blank=True,
        editable=False,
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
    discarded_at = models.DateTimeField(null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)
        permissions = (("review_source_proposal", "Can review Source Proposals"),)
        constraints = [
            models.UniqueConstraint(
                fields=("submitter", "normalized_domain"),
                condition=models.Q(
                    discarded_at__isnull=True,
                    state__in=(
                        SourceProposalState.DRAFT,
                        SourceProposalState.PENDING,
                        SourceProposalState.CHANGES_REQUESTED,
                    ),
                )
                & ~models.Q(normalized_domain=""),
                name="one_open_source_proposal_per_account_domain",
            )
        ]

    def __str__(self) -> str:
        return self.website_name or f"Source Proposal {self.id}"

    @property
    def can_discard(self) -> bool:
        return self.state == SourceProposalState.DRAFT and self.discarded_at is None


class ImmutableSourceProposalEventQuerySet(models.QuerySet["SourceProposalEvent"]):
    def update(self, **kwargs: Any) -> int:
        raise ValidationError("Source Proposal history is immutable.")

    def delete(self) -> tuple[int, dict[str, int]]:
        raise ValidationError("Source Proposal history is immutable.")


class SourceProposalEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    proposal = models.ForeignKey(SourceProposal, on_delete=models.PROTECT, related_name="events")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=set_null_in_immutable_history,
        related_name="source_proposal_events",
        null=True,
    )
    revision = models.PositiveIntegerField()
    prior_state = models.CharField(max_length=24, choices=SourceProposalState)
    new_state = models.CharField(max_length=24, choices=SourceProposalState)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects: ClassVar[models.Manager[SourceProposalEvent]] = models.Manager.from_queryset(
        ImmutableSourceProposalEventQuerySet
    )()

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"{self.proposal_id}: {self.prior_state} → {self.new_state}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self._state.adding:
            raise ValidationError("Source Proposal history is immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        raise ValidationError("Source Proposal history is immutable.")


class SourceProposalReviewClaim(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    proposal = models.ForeignKey(
        SourceProposal, on_delete=models.CASCADE, related_name="review_claims"
    )
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="source_proposal_review_claims",
    )
    revision = models.PositiveIntegerField()
    expires_at = models.DateTimeField()
    released_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("proposal", "revision"),
                condition=models.Q(released_at__isnull=True),
                name="one_open_source_proposal_claim_per_revision",
            )
        ]

    def __str__(self) -> str:
        return f"{self.proposal_id}: {self.operator_id} (revision {self.revision})"


class ExternalListingCandidateState(models.TextChoices):
    PENDING = "pending", "در انتظار بررسی"
    CHANGES_REQUESTED = "changes_requested", "نیازمند اصلاح"
    REJECTED = "rejected", "ردشده"
    PUBLISHED = "published", "منتشرشده"


class ExternalListingCandidate(models.Model):
    """Deterministic sample discovery awaiting an independent Operator decision."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source_proposal = models.ForeignKey(
        SourceProposal,
        on_delete=models.PROTECT,
        related_name="external_listing_candidates",
    )
    source = models.ForeignKey(
        "catalog.Source",
        on_delete=models.PROTECT,
        related_name="external_listing_candidates",
    )
    listing = models.OneToOneField(
        "catalog.Listing",
        on_delete=models.PROTECT,
        related_name="external_candidate",
        null=True,
        blank=True,
        editable=False,
    )
    state = models.CharField(
        max_length=20,
        choices=ExternalListingCandidateState,
        default=ExternalListingCandidateState.PENDING,
    )
    revision = models.PositiveIntegerField(default=1, editable=False)
    simulated = models.BooleanField(default=True, editable=False)
    title = models.CharField(max_length=200)
    external_url = models.URLField(max_length=1000)
    city = models.ForeignKey("catalog.City", on_delete=models.PROTECT)
    district = models.ForeignKey("catalog.District", on_delete=models.PROTECT)
    neighborhood = models.ForeignKey("catalog.Neighborhood", on_delete=models.PROTECT)
    property_type = models.CharField(max_length=16, choices=PropertyType)
    area_sqm = models.PositiveIntegerField()
    room_count = models.PositiveSmallIntegerField(null=True, blank=True)
    deposit_rial = models.PositiveBigIntegerField()
    monthly_rent_rial = models.PositiveBigIntegerField()
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("source_proposal", "external_url"),
                name="unique_external_candidate_url_per_proposal",
            )
        ]

    def __str__(self) -> str:
        return self.title


class ExternalListingCandidateEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    candidate = models.ForeignKey(
        ExternalListingCandidate,
        on_delete=models.PROTECT,
        related_name="events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="external_listing_candidate_events",
    )
    revision = models.PositiveIntegerField()
    prior_state = models.CharField(max_length=20, choices=ExternalListingCandidateState)
    new_state = models.CharField(max_length=20, choices=ExternalListingCandidateState)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"{self.candidate_id}: {self.prior_state} → {self.new_state}"


class ExternalListingCandidateReviewClaim(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    candidate = models.ForeignKey(
        ExternalListingCandidate,
        on_delete=models.CASCADE,
        related_name="review_claims",
    )
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="external_listing_candidate_review_claims",
    )
    revision = models.PositiveIntegerField()
    expires_at = models.DateTimeField()
    released_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("candidate", "revision"),
                condition=models.Q(released_at__isnull=True),
                name="one_open_external_candidate_claim_per_revision",
            )
        ]

    def __str__(self) -> str:
        return f"{self.candidate_id}: {self.operator_id} (revision {self.revision})"
