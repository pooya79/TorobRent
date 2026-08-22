from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models

from apps.catalog.models import FeatureState, PropertyType


class SubmitterRole(models.TextChoices):
    OWNER = "owner", "مالک"
    AGENT = "agent", "نماینده مالک"


class SubmissionState(models.TextChoices):
    DRAFT = "draft", "پیش‌نویس"


class SubmissionStep(models.TextChoices):
    LOCATION = "location", "نشانی ملک"
    PROPERTY_FACTS = "property_facts", "مشخصات ملک"
    RENTAL_TERMS = "rental_terms", "شرایط اجاره"
    FEATURES_DESCRIPTION = "features_description", "امکانات و توضیحات"
    IMAGES = "images", "تصاویر"
    CONTACT = "contact", "اطلاعات تماس"
    REVIEW = "review", "بازبینی"


class SubmissionImageStatus(models.TextChoices):
    PENDING = "pending", "در صف پردازش"
    PROCESSING = "processing", "در حال پردازش"
    READY = "ready", "آماده"
    FAILED = "failed", "ناموفق"


class SubmissionImageVariantKind(models.TextChoices):
    SMALL = "small", "کوچک"
    MEDIUM = "medium", "متوسط"
    LARGE = "large", "بزرگ"


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
    state = models.CharField(max_length=16, choices=SubmissionState, default=SubmissionState.DRAFT)
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)

    def __str__(self) -> str:
        return f"{self.get_role_display()}: {self.id}"


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
