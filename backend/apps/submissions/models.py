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
