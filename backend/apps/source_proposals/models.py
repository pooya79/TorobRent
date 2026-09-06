from __future__ import annotations

import uuid
from typing import Any, ClassVar

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.catalog.models import PropertyType
from apps.common.deletion import set_null_in_immutable_history


class SourceProposalState(models.TextChoices):
    DRAFT = "draft", "پیش‌نویس"
    PENDING = "pending", "در انتظار بررسی"
    CHANGES_REQUESTED = "changes_requested", "نیازمند اصلاح"
    REJECTED = "rejected", "ردشده"
    APPROVED = "approved", "تأییدشده"
    REVOKED = "revoked", "تخصیص لغوشده"


class SourceProposalStep(models.TextChoices):
    DETAILS = "details", "اطلاعات وب‌سایت"
    PREVIEW = "preview", "بازبینی اطلاعات"


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


class DiscoveryStage(models.TextChoices):
    AWAITING_URL = "awaiting_url", "در انتظار تأیید نشانی"
    QUEUED = "queued", "در انتظار کشف"
    RUNNING = "running", "در حال کشف"
    COMPLETE = "complete", "کشف پایان یافت؛ در انتظار بررسی پروفایل"
    FAILED = "failed", "کشف ناموفق"
    RELEASED = "released", "رزرو آزاد شده"


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
    discovery_stage = models.CharField(
        max_length=24, choices=DiscoveryStage, default=DiscoveryStage.AWAITING_URL
    )
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

    def confirmation_summary(self) -> dict[str, str]:
        return {
            "title": "بازبینی اطلاعات وب‌سایت",
            "disclaimer": (
                "تا پیش از تأیید نشانی توسط اپراتور هیچ درخواستی به وب‌سایت ارسال نمی‌شود."
            ),
            "inventory_range": self.inventory_range,
        }

    @property
    def can_discard(self) -> bool:
        return (
            self.state in (SourceProposalState.DRAFT, SourceProposalState.CHANGES_REQUESTED)
            and self.discarded_at is None
            and not self.sourceassignment_set.filter(revoked_at__isnull=True).exists()
        )


class ImmutableSourceProposalEventQuerySet(models.QuerySet["SourceProposalEvent"]):
    def update(self, **kwargs: Any) -> int:
        raise ValidationError("Source Proposal history is immutable.")

    def delete(self) -> tuple[int, dict[str, int]]:
        raise ValidationError("Source Proposal history is immutable.")


class SourceProposalEvent(models.Model):
    processing_action = models.CharField(max_length=6, blank=True, default="", db_default="")
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


class ImmutableProfileQuerySet(models.QuerySet[Any]):
    def update(self, **kwargs: Any) -> int:
        raise ValidationError("Source Profile history is immutable.")

    def delete(self) -> tuple[int, dict[str, int]]:
        raise ValidationError("Source Profile history is immutable.")


class ImmutableProfileRecord(models.Model):
    objects: ClassVar[models.Manager[Any]] = models.Manager.from_queryset(
        ImmutableProfileQuerySet
    )()

    class Meta:
        abstract = True

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self._state.adding:
            raise ValidationError("Source Profile history is immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        raise ValidationError("Source Profile history is immutable.")


class ExternalListingCandidateState(models.TextChoices):
    PENDING = "pending", "در انتظار بررسی"
    CHANGES_REQUESTED = "changes_requested", "نیازمند اصلاح"
    REJECTED = "rejected", "ردشده"
    PUBLISHED = "published", "منتشرشده"
    CANCELLED = "cancelled", "لغوشده"


class ExternalListingCandidate(models.Model):
    superseded = models.BooleanField(default=False, db_default=False)
    exclusion_hold = models.ForeignKey(
        "SourceExclusion", on_delete=models.PROTECT, null=True, related_name="held_candidates"
    )
    discovery_version = models.ForeignKey(
        "SourceProfileVersion", on_delete=models.PROTECT, null=True, related_name="media_candidates"
    )
    """A retained extraction result awaiting catalog publication or correction."""

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
    listing = models.ForeignKey(
        "catalog.Listing",
        on_delete=models.PROTECT,
        related_name="external_candidates",
        null=True,
        blank=True,
        editable=False,
    )
    extraction_run = models.ForeignKey(
        "ExtractionRun", on_delete=models.PROTECT, related_name="candidates", null=True
    )
    source_claims = models.JSONField(default=dict, db_default={})
    evidence = models.JSONField(default=dict, db_default={})
    conflicts = models.JSONField(default=dict, db_default={})
    validation_errors = models.JSONField(default=dict, db_default={})
    corrections = models.JSONField(default=dict, db_default={})
    state = models.CharField(
        max_length=20,
        choices=ExternalListingCandidateState,
        default=ExternalListingCandidateState.PENDING,
    )
    revision = models.PositiveIntegerField(default=1, editable=False)
    title = models.CharField(max_length=200)
    external_url = models.URLField(max_length=1000)
    city = models.ForeignKey("catalog.City", on_delete=models.PROTECT, null=True)
    district = models.ForeignKey("catalog.District", on_delete=models.PROTECT, null=True)
    neighborhood = models.ForeignKey("catalog.Neighborhood", on_delete=models.PROTECT, null=True)
    property_type = models.CharField(max_length=16, choices=PropertyType, blank=True)
    area_sqm = models.PositiveIntegerField(null=True)
    room_count = models.PositiveSmallIntegerField(null=True, blank=True)
    deposit_rial = models.PositiveBigIntegerField(null=True)
    monthly_rent_rial = models.PositiveBigIntegerField(null=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("source_proposal", "external_url"),
                name="unique_external_candidate_url_per_proposal",
                condition=models.Q(extraction_run__isnull=True, discovery_version__isnull=True),
            ),
            models.UniqueConstraint(
                fields=("extraction_run", "external_url"), name="unique_candidate_url_per_run"
            ),
            models.UniqueConstraint(
                fields=("discovery_version", "external_url"), name="unique_discovery_candidate_url"
            ),
        ]

    def __str__(self) -> str:
        return self.title


class ExternalListingCandidateEvent(ImmutableProfileRecord):
    corrections = models.JSONField(default=dict, db_default={})
    objects: ClassVar[models.Manager[ExternalListingCandidateEvent]] = models.Manager.from_queryset(
        ImmutableProfileQuerySet
    )()
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
        null=True,
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


class SourceReservation(models.Model):
    """One auditable approval attempt; the Source row serializes host authorization."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.ForeignKey("catalog.Source", on_delete=models.PROTECT)
    proposal = models.ForeignKey(
        SourceProposal, on_delete=models.PROTECT, related_name="reservations"
    )
    revision = models.PositiveIntegerField()
    approved_url = models.URLField(max_length=1000)
    max_pages = models.PositiveIntegerField(default=50)
    target_detail_pages = models.PositiveIntegerField(default=30)
    expires_at = models.DateTimeField()
    released_at = models.DateTimeField(null=True)
    release_reason = models.CharField(max_length=32, blank=True)
    started_at = models.DateTimeField(null=True)
    completed_at = models.DateTimeField(null=True)
    evidence = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("source",),
                condition=models.Q(released_at__isnull=True),
                name="one_open_reservation_per_source",
            )
        ]

    def __str__(self) -> str:
        return f"{self.proposal_id}: {self.approved_url}"


class SourceAssignment(models.Model):
    revocation = models.OneToOneField(
        SourceProposalEvent, on_delete=models.PROTECT, null=True, related_name="revoked_assignment"
    )
    approval = models.OneToOneField(
        "SourceProfileDecision", on_delete=models.PROTECT, null=True, related_name="assignment"
    )
    source = models.ForeignKey(
        "catalog.Source", on_delete=models.PROTECT, related_name="assignments"
    )
    representative = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True
    )
    proposal = models.ForeignKey(SourceProposal, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("source",),
                condition=models.Q(revoked_at__isnull=True),
                name="one_active_assignment_per_source",
            )
        ]

    def __str__(self) -> str:
        return f"{self.source_id}: {self.representative_id}"


class ProfileReviewMode(models.TextChoices):
    APPROVAL_REQUIRED = "approval_required", "نیازمند تأیید"
    AUTOMATIC = "automatic", "خودکار"


class SourceProfile(models.Model):
    source = models.OneToOneField(
        "catalog.Source", on_delete=models.PROTECT, related_name="profile"
    )
    active_version = models.OneToOneField(
        "SourceProfileVersion", on_delete=models.PROTECT, null=True, related_name="active_profile"
    )

    def __str__(self) -> str:
        return f"Source Profile {self.source_id}"


class SourceProfileVersion(ImmutableProfileRecord):
    objects: ClassVar[models.Manager[SourceProfileVersion]] = models.Manager.from_queryset(
        ImmutableProfileQuerySet
    )()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    profile = models.ForeignKey(SourceProfile, on_delete=models.PROTECT, related_name="versions")
    reservation = models.ForeignKey(
        SourceReservation, on_delete=models.PROTECT, related_name="profile_versions"
    )
    number = models.PositiveIntegerField()
    parent = models.ForeignKey("self", on_delete=models.PROTECT, null=True)
    rules = models.JSONField()
    structural_fingerprint = models.TextField()
    validation = models.JSONField()
    samples = models.JSONField()
    exclusions = models.JSONField()
    diagnostics = models.JSONField(default=dict)
    pipeline_version = models.CharField(max_length=64)
    provenance = models.CharField(
        max_length=16,
        choices=(("discovery", "Discovery"), ("manual", "Manual"), ("llm", "LLM repair")),
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=set_null_in_immutable_history, null=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-number",)
        constraints = [
            models.UniqueConstraint(
                fields=("profile", "number"), name="unique_source_profile_version"
            ),
            models.UniqueConstraint(
                fields=("reservation",),
                condition=models.Q(provenance="discovery"),
                name="one_initial_profile_per_discovery",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.profile_id}: version {self.number}"


class SourceProfileDecision(ImmutableProfileRecord):
    objects: ClassVar[models.Manager[SourceProfileDecision]] = models.Manager.from_queryset(
        ImmutableProfileQuerySet
    )()
    version = models.OneToOneField(
        SourceProfileVersion, on_delete=models.PROTECT, related_name="decision"
    )
    representative = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=set_null_in_immutable_history,
        null=True,
        related_name="source_profile_decisions",
    )
    event = models.OneToOneField(SourceProposalEvent, on_delete=models.PROTECT)
    review_mode = models.CharField(max_length=24, choices=ProfileReviewMode, blank=True)
    limitations_acknowledged = models.BooleanField(default=False, db_default=False)

    def __str__(self) -> str:
        return f"Profile decision {self.version_id}"


class SourceProfileSnapshots(models.Model):
    reservation = models.OneToOneField(SourceReservation, on_delete=models.PROTECT)
    pages = models.JSONField()
    expires_at = models.DateTimeField()

    def __str__(self) -> str:
        return f"Validation snapshots {self.reservation_id}"


class SourceProfileRepair(ImmutableProfileRecord):
    """A durable explicit request; a lost response never authorizes another model call."""

    objects: ClassVar[models.Manager[SourceProfileRepair]] = models.Manager.from_queryset(
        ImmutableProfileQuerySet
    )()
    id = models.UUIDField(primary_key=True, editable=False)
    parent = models.ForeignKey(
        SourceProfileVersion, on_delete=models.PROTECT, related_name="repairs"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=set_null_in_immutable_history, null=True
    )
    reviewed_revision = models.PositiveIntegerField()
    selected_fields = models.JSONField()
    model = models.CharField(max_length=128)
    prompt_version = models.CharField(max_length=64)
    schema_version = models.CharField(max_length=64)
    evidence_sha256 = models.CharField(max_length=64)
    started_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ("-started_at",)

    def __str__(self) -> str:
        return f"Profile repair {self.pk}"


class SourceProfileRepairResult(ImmutableProfileRecord):
    objects: ClassVar[models.Manager[SourceProfileRepairResult]] = models.Manager.from_queryset(
        ImmutableProfileQuerySet
    )()
    repair = models.OneToOneField(
        SourceProfileRepair, on_delete=models.PROTECT, related_name="result"
    )
    outcome = models.CharField(max_length=32)
    detail = models.TextField()
    structured_result = models.JSONField(null=True)
    validation = models.JSONField(default=dict)
    result_version = models.OneToOneField(SourceProfileVersion, on_delete=models.PROTECT, null=True)
    finished_at = models.DateTimeField(default=timezone.now)
    duration_ms = models.PositiveIntegerField()

    def __str__(self) -> str:
        return f"Profile repair {self.repair_id}: {self.outcome}"


class ExtractionState(models.TextChoices):
    QUEUED = "queued", "در صف"
    RUNNING = "running", "در حال استخراج"
    COMPLETE = "complete", "پایان یافته"
    FAILED = "failed", "ناموفق"
    CANCELLED = "cancelled", "لغوشده"


class ExtractionRequest(models.Model):
    processing_revision = models.PositiveIntegerField(default=0, db_default=0)
    initiated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="initiated_extractions",
    )
    publication_revision = models.PositiveIntegerField(default=0, db_default=0)
    review_mode = models.CharField(
        max_length=24, choices=ProfileReviewMode, default="", db_default=""
    )
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    assignment = models.ForeignKey(
        SourceAssignment, on_delete=models.PROTECT, related_name="requests"
    )
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    profile_version = models.ForeignKey(SourceProfileVersion, on_delete=models.PROTECT)
    submitted_url = models.URLField(max_length=1000)
    canonical_url = models.URLField(max_length=1000)
    state = models.CharField(max_length=16, choices=ExtractionState, default=ExtractionState.QUEUED)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self) -> str:
        return f"Extraction Request {self.pk}"


class ExtractionRun(models.Model):
    skipped_pages = models.JSONField(default=list, db_default=[])
    withdrawals = models.JSONField(default=list, db_default=[])
    candidate_rejected = models.PositiveIntegerField(default=0, db_default=0)
    revision = models.PositiveIntegerField(default=1, db_default=1)
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.OneToOneField(ExtractionRequest, on_delete=models.PROTECT, related_name="run")
    profile_version = models.ForeignKey(SourceProfileVersion, on_delete=models.PROTECT)
    pipeline_version = models.CharField(max_length=64)
    state = models.CharField(
        max_length=16, choices=ExtractionState, default=ExtractionState.RUNNING
    )
    attempts = models.PositiveIntegerField(default=1)
    started_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True)
    discovered = models.PositiveIntegerField(default=0)
    extracted = models.PositiveIntegerField(default=0)
    published = models.PositiveIntegerField(default=0)
    needs_attention = models.PositiveIntegerField(default=0)
    rejected = models.PositiveIntegerField(default=0)
    failed = models.PositiveIntegerField(default=0)
    errors = models.JSONField(default=list)
    results = models.JSONField(default=list)

    def __str__(self) -> str:
        return f"Extraction Run {self.pk}"


class ExtractionRunDecision(ImmutableProfileRecord):
    objects: ClassVar[models.Manager[ExtractionRunDecision]] = models.Manager.from_queryset(
        ImmutableProfileQuerySet
    )()
    run = models.ForeignKey(ExtractionRun, on_delete=models.PROTECT, related_name="decisions")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    revision = models.PositiveIntegerField()
    candidate_ids = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("run", "revision"), name="one_decision_per_run_revision"
            )
        ]

    def __str__(self) -> str:
        return f"Extraction Run {self.run_id}: approval of revision {self.revision}"


class SourceImageHost(models.Model):
    """An exact CDN host explicitly approved by an Operator for one Source."""

    source = models.ForeignKey(
        "catalog.Source", on_delete=models.PROTECT, related_name="image_hosts"
    )
    host = models.CharField(max_length=253)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    approved_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("source", "host"), name="unique_source_image_host")
        ]

    def __str__(self) -> str:
        return self.host

    def clean(self) -> None:
        from .url_validation import normalize_public_domain

        self.host = normalize_public_domain(f"https://{self.host}")


class CandidateImage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    candidate = models.ForeignKey(
        ExternalListingCandidate, on_delete=models.PROTECT, related_name="images"
    )
    original_url = models.TextField()
    source_order = models.PositiveSmallIntegerField()
    position = models.PositiveSmallIntegerField()
    is_primary = models.BooleanField(default=False)
    excluded = models.BooleanField(default=False)
    state = models.CharField(max_length=16, default="pending")
    failure_code = models.CharField(max_length=64, blank=True)
    content_hash = models.CharField(max_length=64, blank=True)
    listing_image = models.OneToOneField(
        "catalog.ListingImage", on_delete=models.SET_NULL, null=True, related_name="external_origin"
    )
    property_image = models.ForeignKey(
        "catalog.PropertyImage",
        on_delete=models.SET_NULL,
        null=True,
        related_name="external_origins",
    )
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="accepted_external_images",
    )
    accepted_at = models.DateTimeField(null=True)
    retention_checked_at = models.DateTimeField(null=True, db_index=True)
    unreferenced_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("position", "source_order", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("candidate", "source_order"), name="unique_candidate_image_source_order"
            ),
            models.UniqueConstraint(
                fields=("candidate",),
                condition=models.Q(is_primary=True),
                name="one_primary_candidate_image",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.candidate_id}: {self.source_order}"


class CandidateImageVariant(models.Model):
    image = models.ForeignKey(CandidateImage, on_delete=models.PROTECT, related_name="variants")
    kind = models.CharField(max_length=8)
    asset = models.ForeignKey(
        "common.MediaAsset", on_delete=models.PROTECT, null=True, related_name="candidate_variants"
    )
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    byte_size = models.PositiveIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("image", "kind"), name="unique_candidate_image_variant")
        ]

    def __str__(self) -> str:
        return f"{self.image_id}: {self.kind}"


class SourceResponsibilityChange(ImmutableProfileRecord):
    source = models.ForeignKey(
        "catalog.Source", on_delete=models.PROTECT, related_name="responsibility_history"
    )
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=set_null_in_immutable_history,
        null=True,
        related_name="source_responsibilities",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=set_null_in_immutable_history,
        null=True,
        related_name="source_responsibility_changes",
    )
    revision = models.PositiveIntegerField()
    reason = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ("revision",)
        constraints = [
            models.UniqueConstraint(
                fields=("source", "revision"), name="unique_source_responsibility_revision"
            )
        ]

    def __str__(self) -> str:
        return f"{self.source_id}: responsibility {self.revision}"


class SourcePublicationModeChange(ImmutableProfileRecord):
    objects: ClassVar[models.Manager[SourcePublicationModeChange]] = models.Manager.from_queryset(
        ImmutableProfileQuerySet
    )()
    approval = models.ForeignKey(
        SourceProfileDecision, on_delete=models.PROTECT, related_name="publication_changes"
    )
    event = models.OneToOneField(
        SourceProposalEvent, on_delete=models.PROTECT, related_name="publication_mode_change"
    )
    revision = models.PositiveIntegerField()
    review_mode = models.CharField(max_length=24, choices=ProfileReviewMode)

    class Meta:
        ordering = ("revision",)
        constraints = [
            models.UniqueConstraint(
                fields=("approval", "revision"), name="unique_publication_mode_revision"
            )
        ]

    def __str__(self) -> str:
        return f"Publication mode {self.approval_id}: revision {self.revision}"


class SourceExclusion(ImmutableProfileRecord):
    objects: ClassVar[models.Manager[SourceExclusion]] = models.Manager.from_queryset(
        ImmutableProfileQuerySet
    )()
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.ForeignKey(
        "catalog.Source", on_delete=models.PROTECT, related_name="exclusions"
    )
    kind = models.CharField(
        max_length=16, choices=(("exact", "Exact URL"), ("path_prefix", "Path section"))
    )
    url = models.URLField(max_length=1000)
    reason = models.CharField(max_length=2000)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=set_null_in_immutable_history, null=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"{self.kind}: {self.url}"


class SourceExclusionAction(ImmutableProfileRecord):
    objects: ClassVar[models.Manager[SourceExclusionAction]] = models.Manager.from_queryset(
        ImmutableProfileQuerySet
    )()
    exclusion = models.ForeignKey(SourceExclusion, on_delete=models.PROTECT, related_name="actions")
    action = models.CharField(
        max_length=16, choices=(("remove", "Remove"), ("withdraw", "Withdraw Listings"))
    )
    reason = models.CharField(max_length=2000)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=set_null_in_immutable_history, null=True
    )
    listing_ids = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("exclusion",),
                condition=models.Q(action="remove"),
                name="one_exclusion_removal",
            )
        ]

    def __str__(self) -> str:
        return f"{self.action}: {self.exclusion_id}"


class SourceExtractionException(models.Model):
    """Latest page outcome also fences late failures after a first successful extraction."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.ForeignKey(
        "catalog.Source", on_delete=models.PROTECT, related_name="exceptions"
    )
    canonical_url = models.URLField(max_length=1000)
    first_occurrence = models.DateTimeField(null=True)
    state = models.CharField(
        max_length=16,
        choices=[("open", "باز"), ("resolved", "رفع شده"), ("excluded", "کنار گذاشته شده")],
    )
    problem = models.CharField(max_length=64, blank=True)
    detail = models.TextField(blank=True)
    last_run = models.ForeignKey(ExtractionRun, on_delete=models.PROTECT)
    last_attempt = models.PositiveIntegerField()
    last_attempt_at = models.DateTimeField()

    class Meta:
        ordering = ("canonical_url",)
        constraints = [
            models.UniqueConstraint(
                fields=("source", "canonical_url"), name="unique_source_exception_url"
            )
        ]

    def __str__(self) -> str:
        return self.canonical_url


class SourceExceptionAttempt(models.Model):
    exception = models.ForeignKey(
        SourceExtractionException, on_delete=models.CASCADE, related_name="history"
    )
    run = models.ForeignKey(ExtractionRun, on_delete=models.PROTECT)
    attempt = models.PositiveIntegerField()
    attempted_at = models.DateTimeField()
    state = models.CharField(max_length=16)
    problem = models.CharField(max_length=64, blank=True)
    detail = models.TextField(blank=True)
    is_current = models.BooleanField()

    class Meta:
        ordering = ("-attempted_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("exception", "run", "attempt"), name="unique_exception_run_attempt"
            )
        ]

    def __str__(self) -> str:
        return f"Exception attempt {self.run_id}/{self.attempt}"


class SourceBulkAction(models.Model):
    source = models.ForeignKey("catalog.Source", on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    token_hash = models.CharField(max_length=64, unique=True)
    action = models.CharField(max_length=24)
    exception_ids = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Source bulk {self.action} {self.pk}"
