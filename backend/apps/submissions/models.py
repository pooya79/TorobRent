from __future__ import annotations

import uuid
from collections.abc import Collection, Iterable
from typing import Any, ClassVar

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.catalog.models import FeatureState, PropertyType
from apps.common.media import MediaVariantKind


class SubmitterRole(models.TextChoices):
    OWNER = "owner", "مالک"
    AGENT = "agent", "نماینده مالک"


class SubmissionState(models.TextChoices):
    DRAFT = "draft", "پیش‌نویس"
    PENDING = "pending", "در انتظار بررسی"
    CHANGES_REQUESTED = "changes_requested", "نیازمند اصلاح"
    REJECTED = "rejected", "ردشده"
    PUBLISHED = "published", "منتشرشده"


class SubmissionStep(models.TextChoices):
    LOCATION = "location", "نشانی ملک"
    PROPERTY_FACTS = "property_facts", "مشخصات ملک"
    RENTAL_TERMS = "rental_terms", "شرایط اجاره"
    FEATURES_DESCRIPTION = "features_description", "امکانات و توضیحات"
    IMAGES = "images", "تصاویر"
    CONTACT = "contact", "اطلاعات تماس"
    REVIEW = "review", "بازبینی"


class SubmissionEventType(models.TextChoices):
    TRANSITION = "transition", "تغییر وضعیت"
    DECISION_CORRECTION = "decision_correction", "اصلاح تصمیم"


class SubmissionDecisionNotificationStatus(models.TextChoices):
    PENDING = "pending", "در انتظار ارسال"
    DELIVERED = "delivered", "ارسال‌شده"
    FAILED = "failed", "ناموفق"


class SubmissionDecisionNotificationFailure(models.TextChoices):
    DISPATCH_FAILED = "dispatch_failed", "صف ارسال در دسترس نبود"
    DELIVERY_FAILED = "delivery_failed", "سرویس ایمیل پیام را نپذیرفت"


class SubmissionImageStatus(models.TextChoices):
    PENDING = "pending", "در صف پردازش"
    PROCESSING = "processing", "در حال پردازش"
    READY = "ready", "آماده"
    FAILED = "failed", "ناموفق"


SubmissionImageVariantKind = MediaVariantKind


def submission_image_upload_path(instance: SubmissionImage, _filename: str) -> str:
    return f"submission-media/{instance.submission_id}/{instance.id}/source.upload"


def submission_image_variant_path(instance: SubmissionImageVariant, _filename: str) -> str:
    image = instance.image
    return f"submission-media/{image.submission_id}/{image.id}/{instance.kind}.webp"


class Submission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submitter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="submissions",
    )
    role = models.CharField(max_length=8, choices=SubmitterRole)
    state = models.CharField(max_length=20, choices=SubmissionState, default=SubmissionState.DRAFT)
    revision = models.PositiveIntegerField(default=1, editable=False)
    source = models.ForeignKey(
        "catalog.Source",
        on_delete=models.PROTECT,
        related_name="submissions",
        null=True,
        blank=True,
    )
    listing = models.OneToOneField(
        "catalog.Listing",
        on_delete=models.PROTECT,
        related_name="submission",
        null=True,
        blank=True,
        editable=False,
    )
    current_step = models.CharField(
        max_length=32,
        choices=SubmissionStep,
        default=SubmissionStep.LOCATION,
    )
    media_complete = models.BooleanField(default=False, editable=False)
    city = models.ForeignKey("catalog.City", on_delete=models.PROTECT, null=True, blank=True)
    district = models.ForeignKey(
        "catalog.District", on_delete=models.PROTECT, null=True, blank=True
    )
    neighborhood = models.ForeignKey(
        "catalog.Neighborhood", on_delete=models.PROTECT, null=True, blank=True
    )
    address = models.TextField(blank=True)
    property_type = models.CharField(max_length=16, choices=PropertyType, blank=True)
    area_sqm = models.PositiveIntegerField(null=True, blank=True)
    room_count = models.PositiveSmallIntegerField(null=True, blank=True)
    construction_year = models.PositiveSmallIntegerField(null=True, blank=True)
    floor = models.SmallIntegerField(null=True, blank=True)
    total_floors = models.PositiveSmallIntegerField(null=True, blank=True)
    units_per_floor = models.PositiveSmallIntegerField(null=True, blank=True)
    deposit_rial = models.PositiveBigIntegerField(null=True, blank=True)
    monthly_rent_rial = models.PositiveBigIntegerField(null=True, blank=True)
    is_negotiable = models.BooleanField(default=False)
    is_convertible = models.BooleanField(default=False)
    parking = models.CharField(max_length=8, choices=FeatureState, default=FeatureState.UNKNOWN)
    elevator = models.CharField(max_length=8, choices=FeatureState, default=FeatureState.UNKNOWN)
    storage = models.CharField(max_length=8, choices=FeatureState, default=FeatureState.UNKNOWN)
    balcony = models.CharField(max_length=8, choices=FeatureState, default=FeatureState.UNKNOWN)
    furnished = models.CharField(max_length=8, choices=FeatureState, default=FeatureState.UNKNOWN)
    description = models.TextField(blank=True)
    contact_name = models.CharField(max_length=120, blank=True)
    contact_phone = models.CharField(max_length=32, blank=True)
    authorization_declared = models.BooleanField(default=False)
    phone_publication_consent = models.BooleanField(default=False)
    review_data = models.JSONField(default=dict, blank=True)
    pending_since = models.DateTimeField(null=True, blank=True, db_index=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)
        permissions = (("review_submission", "Can review and publish Submissions"),)

    def __str__(self) -> str:
        return f"{self.get_role_display()}: {self.id}"


class ImmutableSubmissionEventQuerySet(models.QuerySet["SubmissionEvent"]):
    def update(self, **kwargs: Any) -> int:
        raise ValidationError("Submission decision history is immutable.")

    def delete(self) -> tuple[int, dict[str, int]]:
        raise ValidationError("Submission decision history is immutable.")

    def bulk_update(
        self,
        objs: Iterable[SubmissionEvent],
        fields: Iterable[str],
        batch_size: int | None = None,
    ) -> int:
        raise ValidationError("Submission decision history is immutable.")

    def bulk_create(
        self,
        objs: Iterable[SubmissionEvent],
        batch_size: int | None = None,
        ignore_conflicts: bool = False,
        update_conflicts: bool = False,
        update_fields: Collection[str] | None = None,
        unique_fields: Collection[str] | None = None,
    ) -> list[SubmissionEvent]:
        if update_conflicts:
            raise ValidationError("Submission decision history is immutable.")
        return super().bulk_create(
            objs,
            batch_size=batch_size,
            ignore_conflicts=ignore_conflicts,
            update_conflicts=update_conflicts,
            update_fields=update_fields,
            unique_fields=unique_fields,
        )


class SubmissionEventManager(models.Manager["SubmissionEvent"]):
    def get_queryset(self) -> ImmutableSubmissionEventQuerySet:
        return ImmutableSubmissionEventQuerySet(self.model, using=self._db)


class SubmissionEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submission = models.ForeignKey(
        Submission,
        on_delete=models.PROTECT,
        related_name="events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="submission_events",
    )
    event_type = models.CharField(
        max_length=24,
        choices=SubmissionEventType,
        default=SubmissionEventType.TRANSITION,
    )
    review_claim = models.ForeignKey(
        "ReviewClaim",
        on_delete=models.PROTECT,
        related_name="decision_events",
        null=True,
        blank=True,
    )
    revision = models.PositiveIntegerField()
    prior_state = models.CharField(max_length=20, choices=SubmissionState)
    new_state = models.CharField(max_length=20, choices=SubmissionState)
    reason = models.TextField(blank=True)
    normalized_corrections = models.JSONField(default=dict, blank=True)
    publication_result = models.JSONField(default=dict, blank=True)
    corrects = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        related_name="corrections",
        null=True,
        blank=True,
    )
    correction = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects: ClassVar[SubmissionEventManager] = SubmissionEventManager()

    class Meta:
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("submission", "revision", "new_state"),
                condition=models.Q(new_state=SubmissionState.PENDING),
                name="one_pending_transition_per_submission_revision",
            )
        ]

    def __str__(self) -> str:
        return f"{self.submission_id}: {self.prior_state} → {self.new_state}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self._state.adding:
            raise ValidationError("Submission decision history is immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        raise ValidationError("Submission decision history is immutable.")


class SubmissionDecisionNotification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    decision = models.OneToOneField(
        SubmissionEvent,
        on_delete=models.PROTECT,
        related_name="notification",
    )
    status = models.CharField(
        max_length=16,
        choices=SubmissionDecisionNotificationStatus,
        default=SubmissionDecisionNotificationStatus.PENDING,
    )
    attempt_count = models.PositiveIntegerField(default=0)
    failure_kind = models.CharField(
        max_length=24,
        choices=SubmissionDecisionNotificationFailure,
        blank=True,
    )
    last_error = models.CharField(max_length=500, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.decision_id}: {self.status}"


class ReviewClaim(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submission = models.ForeignKey(
        Submission,
        on_delete=models.CASCADE,
        related_name="review_claims",
    )
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="submission_review_claims",
    )
    revision = models.PositiveIntegerField()
    expires_at = models.DateTimeField()
    renewed_at = models.DateTimeField()
    released_at = models.DateTimeField(null=True, blank=True)
    released_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="released_submission_review_claims",
        null=True,
        blank=True,
    )
    release_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("submission", "revision"),
                condition=models.Q(released_at__isnull=True),
                name="one_open_review_claim_per_submission_revision",
            )
        ]

    def __str__(self) -> str:
        return f"{self.submission_id}: {self.operator_id} (revision {self.revision})"


class SubmissionImage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submission = models.ForeignKey(
        Submission,
        on_delete=models.CASCADE,
        related_name="images",
    )
    source = models.FileField(upload_to=submission_image_upload_path, max_length=500, blank=True)
    status = models.CharField(
        max_length=16,
        choices=SubmissionImageStatus,
        default=SubmissionImageStatus.PENDING,
    )
    failure_reason = models.CharField(max_length=500, blank=True)
    position = models.PositiveSmallIntegerField()
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("position", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("submission",),
                condition=models.Q(is_primary=True),
                name="one_primary_image_per_submission",
            ),
            models.UniqueConstraint(
                fields=("submission", "position"),
                name="unique_image_position_per_submission",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.submission_id}: {self.position}"


class SubmissionImageVariant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    image = models.ForeignKey(
        SubmissionImage,
        on_delete=models.CASCADE,
        related_name="variants",
    )
    kind = models.CharField(max_length=8, choices=SubmissionImageVariantKind)
    file = models.FileField(upload_to=submission_image_variant_path, max_length=500)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    byte_size = models.PositiveIntegerField()
    asset = models.ForeignKey(
        "MediaAsset",
        null=True,
        on_delete=models.PROTECT,
        related_name="submission_variants",
    )

    class Meta:
        ordering = ("width",)
        constraints = [
            models.UniqueConstraint(
                fields=("image", "kind"),
                name="unique_submission_image_variant",
            )
        ]

    def __str__(self) -> str:
        return f"{self.image_id}: {self.kind}"


class MediaAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.FileField(max_length=500, unique=True)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    byte_size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.file.name or ""
