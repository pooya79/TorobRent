from collections.abc import Mapping
from datetime import timedelta
from typing import Any, cast

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import UploadedFile
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.catalog.models import (
    City,
    District,
    FeatureState,
    ListingState,
    Neighborhood,
    PropertyType,
)
from apps.catalog.money import rial_to_toman
from apps.catalog.serializers import LocalizedIntegerField, TomanRialField

from .audit_serializers import (
    DecisionCorrectionAuditSerializer,
    NormalizedCorrectionsAuditSerializer,
    PublicationResultAuditSerializer,
)
from .models import (
    ReviewClaim,
    Submission,
    SubmissionDecisionNotification,
    SubmissionEvent,
    SubmissionImage,
    SubmissionImageVariant,
    SubmissionState,
    SubmissionStep,
    SubmitterRole,
)
from .services import STEP_DEFINITIONS

MAX_SAFE_TOMAN_FOR_JSON_RIAL = 900_719_925_474_099

REQUIRED_ERROR = "این مقدار الزامی است."
INVALID_NUMBER_ERROR = "یک عدد صحیح نامنفی وارد کنید."
FEATURE_ERRORS: Any = {
    "required": REQUIRED_ERROR,
    "invalid_choice": "وضعیت انتخاب‌شده نامعتبر است.",
}


class SubmissionCreateSerializer(serializers.ModelSerializer[Submission]):
    role = serializers.ChoiceField(
        choices=SubmitterRole.choices,
        error_messages={"required": REQUIRED_ERROR, "invalid_choice": "نقش انتخاب‌شده نامعتبر است."},
    )

    class Meta:
        model = Submission
        fields = ("role",)


class LocationInputSerializer(serializers.Serializer[Any]):
    city_id = serializers.UUIDField(
        required=False, error_messages={"invalid": "شناسه شهر نامعتبر است."}
    )
    district_id = serializers.UUIDField(
        required=False, error_messages={"invalid": "شناسه منطقه نامعتبر است."}
    )
    neighborhood_id = serializers.UUIDField(
        error_messages={"required": REQUIRED_ERROR, "invalid": "شناسه محله نامعتبر است."}
    )
    address = serializers.CharField(
        max_length=1000,
        error_messages={"required": REQUIRED_ERROR, "blank": "نشانی دقیق الزامی است."},
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        try:
            neighborhood = Neighborhood.objects.get(
                id=attrs["neighborhood_id"],
                reviewed=True,
                district__reviewed=True,
                district__city__reviewed=True,
            )
            district = neighborhood.district
            city = district.city
            if (
                attrs.get("city_id", city.id) != city.id
                or attrs.get("district_id", district.id) != district.id
            ):
                raise Neighborhood.DoesNotExist
        except Neighborhood.DoesNotExist:
            raise serializers.ValidationError(
                "شهر، منطقه و محله باید یک مسیر مکانی بازبینی‌شده بسازند."
            ) from None
        attrs.update(city=city, district=district, neighborhood=neighborhood)
        return attrs


class PropertyFactsInputSerializer(serializers.Serializer[Any]):
    property_type = serializers.ChoiceField(
        choices=PropertyType.choices,
        error_messages={"required": REQUIRED_ERROR, "invalid_choice": "نوع ملک نامعتبر است."},
    )
    area_sqm = LocalizedIntegerField(
        min_value=1,
        error_messages={
            "required": REQUIRED_ERROR,
            "invalid": INVALID_NUMBER_ERROR,
            "min_value": "متراژ باید بیشتر از صفر باشد.",
        },
    )
    room_count = LocalizedIntegerField(
        min_value=0,
        error_messages={
            "required": REQUIRED_ERROR,
            "invalid": INVALID_NUMBER_ERROR,
            "min_value": "تعداد اتاق خواب نمی‌تواند منفی باشد.",
        },
    )
    construction_year = LocalizedIntegerField(
        required=False,
        allow_null=True,
        min_value=1200,
        error_messages={
            "invalid": INVALID_NUMBER_ERROR,
            "min_value": "سال ساخت باید ۱۲۰۰ یا پس از آن باشد.",
        },
    )
    floor = LocalizedIntegerField(
        required=False, allow_null=True, error_messages={"invalid": "یک عدد صحیح وارد کنید."}
    )
    total_floors = LocalizedIntegerField(
        required=False,
        allow_null=True,
        min_value=1,
        error_messages={
            "invalid": INVALID_NUMBER_ERROR,
            "min_value": "تعداد طبقات باید مثبت باشد.",
        },
    )
    units_per_floor = LocalizedIntegerField(
        required=False,
        allow_null=True,
        min_value=1,
        error_messages={
            "invalid": INVALID_NUMBER_ERROR,
            "min_value": "تعداد واحدها باید مثبت باشد.",
        },
    )


class RentalTermsInputSerializer(serializers.Serializer[Any]):
    deposit_toman = TomanRialField(
        min_value=0,
        max_value=MAX_SAFE_TOMAN_FOR_JSON_RIAL,
        source="deposit_rial",
        error_messages={
            "required": REQUIRED_ERROR,
            "invalid": INVALID_NUMBER_ERROR,
            "min_value": "مبلغ نمی‌تواند منفی باشد.",
            "max_value": "مبلغ واردشده بیش از حد مجاز است.",
        },
    )
    monthly_rent_toman = TomanRialField(
        min_value=0,
        max_value=MAX_SAFE_TOMAN_FOR_JSON_RIAL,
        source="monthly_rent_rial",
        error_messages={
            "required": REQUIRED_ERROR,
            "invalid": INVALID_NUMBER_ERROR,
            "min_value": "مبلغ نمی‌تواند منفی باشد.",
            "max_value": "مبلغ واردشده بیش از حد مجاز است.",
        },
    )
    is_negotiable = serializers.BooleanField()
    is_convertible = serializers.BooleanField()

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if attrs["deposit_rial"] == 0 and attrs["monthly_rent_rial"] == 0:
            raise serializers.ValidationError("ودیعه و اجاره ماهانه نمی‌توانند هم‌زمان صفر باشند.")
        return attrs


class FeaturesInputSerializer(serializers.Serializer[Any]):
    parking = serializers.ChoiceField(choices=FeatureState.choices, error_messages=FEATURE_ERRORS)
    elevator = serializers.ChoiceField(choices=FeatureState.choices, error_messages=FEATURE_ERRORS)
    storage = serializers.ChoiceField(choices=FeatureState.choices, error_messages=FEATURE_ERRORS)
    balcony = serializers.ChoiceField(choices=FeatureState.choices, error_messages=FEATURE_ERRORS)
    furnished = serializers.ChoiceField(choices=FeatureState.choices, error_messages=FEATURE_ERRORS)


class ContactInputSerializer(serializers.Serializer[Any]):
    name = serializers.CharField(
        max_length=120,
        error_messages={"required": REQUIRED_ERROR, "blank": "نام تماس الزامی است."},
    )
    phone = serializers.CharField(
        max_length=32,
        error_messages={"required": REQUIRED_ERROR, "blank": "شماره تماس الزامی است."},
    )
    authorization_declared = serializers.BooleanField(error_messages={"required": REQUIRED_ERROR})
    phone_publication_consent = serializers.BooleanField(
        error_messages={"required": REQUIRED_ERROR}
    )

    def validate_authorization_declared(self, value: bool) -> bool:
        if not value:
            raise serializers.ValidationError("اعلام اختیار ثبت ملک الزامی است.")
        return value


class ReviewInputSerializer(serializers.Serializer[Any]):
    accuracy_confirmed = serializers.BooleanField(error_messages={"required": REQUIRED_ERROR})

    def validate_accuracy_confirmed(self, value: bool) -> bool:
        if not value:
            raise serializers.ValidationError("تأیید درستی اطلاعات الزامی است.")
        return value


class LocationOutputSerializer(serializers.Serializer[Any]):
    city_id = serializers.UUIDField()
    city = serializers.CharField()
    district_id = serializers.UUIDField()
    district = serializers.CharField()
    neighborhood_id = serializers.UUIDField()
    neighborhood = serializers.CharField()
    address = serializers.CharField()


class RentalTermsOutputSerializer(serializers.Serializer[Any]):
    deposit_rial = serializers.IntegerField()
    monthly_rent_rial = serializers.IntegerField()
    currency = serializers.ChoiceField(choices=("IRR",))
    deposit_toman = serializers.IntegerField()
    monthly_rent_toman = serializers.IntegerField()
    is_negotiable = serializers.BooleanField()
    is_convertible = serializers.BooleanField()


class ContactOutputSerializer(serializers.Serializer[Any]):
    name = serializers.CharField()
    phone = serializers.CharField()
    authorization_declared = serializers.BooleanField()
    phone_publication_consent = serializers.BooleanField()


class SubmissionImageVariantSerializer(serializers.ModelSerializer[SubmissionImageVariant]):
    url = serializers.SerializerMethodField()

    class Meta:
        model = SubmissionImageVariant
        fields = ("kind", "url", "width", "height", "byte_size")

    def get_url(self, variant: SubmissionImageVariant) -> str:
        from django.urls import reverse

        return reverse(
            "submissions:image-content",
            kwargs={
                "submission_id": variant.image.submission_id,
                "image_id": variant.image_id,
                "kind": variant.kind,
            },
        )


class SubmissionImageSerializer(serializers.ModelSerializer[SubmissionImage]):
    variants = SubmissionImageVariantSerializer(many=True, read_only=True)

    class Meta:
        model = SubmissionImage
        fields = (
            "id",
            "status",
            "failure_reason",
            "position",
            "is_primary",
            "variants",
            "created_at",
            "updated_at",
        )


class SubmissionImageUploadSerializer(serializers.Serializer[Any]):
    file = serializers.FileField()

    def validate_file(self, upload: UploadedFile[bytes]) -> UploadedFile[bytes]:
        from .services import validate_image_upload

        try:
            validate_image_upload(upload)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages[0]) from None
        return upload


class SubmissionImageOrderSerializer(serializers.Serializer[Any]):
    image_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=False,
        min_length=1,
        max_length=12,
    )
    primary_image_id = serializers.UUIDField()


class SubmissionStepUpdateSerializer(serializers.Serializer[Any]):
    completed_step = serializers.ChoiceField(
        choices=(
            SubmissionStep.LOCATION,
            SubmissionStep.PROPERTY_FACTS,
            SubmissionStep.RENTAL_TERMS,
            SubmissionStep.FEATURES_DESCRIPTION,
            SubmissionStep.IMAGES,
            SubmissionStep.CONTACT,
            SubmissionStep.REVIEW,
        ),
        write_only=True,
    )
    location = LocationInputSerializer(required=False)
    property_facts = PropertyFactsInputSerializer(required=False)
    rental_terms = RentalTermsInputSerializer(required=False)
    features = FeaturesInputSerializer(required=False)
    description = serializers.CharField(required=False, allow_blank=True, max_length=5000)
    contact = ContactInputSerializer(required=False)
    review = ReviewInputSerializer(required=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        completed_step = attrs["completed_step"]
        if completed_step == SubmissionStep.IMAGES:
            return attrs
        required_section = STEP_DEFINITIONS[completed_step].section
        if required_section not in attrs:
            raise serializers.ValidationError({required_section: "اطلاعات این مرحله الزامی است."})
        return attrs


class SubmissionDecisionNotificationSerializer(
    serializers.ModelSerializer[SubmissionDecisionNotification]
):
    failure_reason = serializers.SerializerMethodField()

    class Meta:
        model = SubmissionDecisionNotification
        fields = (
            "id",
            "status",
            "attempt_count",
            "failure_reason",
            "delivered_at",
            "updated_at",
        )

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_failure_reason(self, notification: SubmissionDecisionNotification) -> str | None:
        return {
            "dispatch_failed": "صف ارسال موقتاً در دسترس نبود.",
            "delivery_failed": "سرویس ایمیل پیام را نپذیرفت.",
        }.get(notification.failure_kind)


class SubmissionWorkloadSummarySerializer(serializers.Serializer[dict[str, int]]):
    unclaimed_count = serializers.IntegerField(min_value=0)
    assigned_to_me_count = serializers.IntegerField(min_value=0)
    aging_count = serializers.IntegerField(min_value=0)
    aging_after_hours = serializers.IntegerField(min_value=1)


class SubmissionEventSerializer(serializers.ModelSerializer[SubmissionEvent]):
    actor_reference = serializers.UUIDField(
        source="actor.historical_actor_reference", read_only=True
    )
    actor_label = serializers.CharField(source="actor.historical_actor_label", read_only=True)
    actor_email = serializers.EmailField(
        source="actor.historical_actor_email", read_only=True, allow_null=True
    )
    reviewed_revision = serializers.IntegerField(source="revision", read_only=True)
    review_claim_id = serializers.UUIDField(read_only=True, allow_null=True)
    corrects_id = serializers.UUIDField(read_only=True, allow_null=True)
    normalized_corrections = NormalizedCorrectionsAuditSerializer(read_only=True)
    publication_result = PublicationResultAuditSerializer(read_only=True)
    correction = DecisionCorrectionAuditSerializer(read_only=True)
    notification = serializers.SerializerMethodField()

    class Meta:
        model = SubmissionEvent
        fields = (
            "id",
            "event_type",
            "actor_reference",
            "actor_label",
            "actor_email",
            "revision",
            "reviewed_revision",
            "review_claim_id",
            "prior_state",
            "new_state",
            "reason",
            "normalized_corrections",
            "publication_result",
            "corrects_id",
            "correction",
            "notification",
            "created_at",
        )

    @extend_schema_field(SubmissionDecisionNotificationSerializer(allow_null=True))
    def get_notification(self, event: SubmissionEvent) -> dict[str, Any] | None:
        notification = getattr(event, "notification", None)
        if notification is None:
            return None
        return dict(SubmissionDecisionNotificationSerializer(notification).data)


class ReviewClaimSerializer(serializers.ModelSerializer[ReviewClaim]):
    operator_email = serializers.EmailField(source="operator.email", read_only=True)

    class Meta:
        model = ReviewClaim
        fields = ("id", "operator_id", "operator_email", "revision", "expires_at", "renewed_at")


class ClaimStatusMixin:
    context: dict[str, Any]

    def _active_claim(self, submission: Submission) -> ReviewClaim | None:
        claims = getattr(submission, "open_review_claims", None)
        if claims is None:
            claims = list(
                submission.review_claims.select_related("operator").filter(
                    revision=submission.revision,
                    released_at__isnull=True,
                    expires_at__gt=timezone.now(),
                )
            )
        return claims[0] if claims else None

    @extend_schema_field(
        serializers.ChoiceField(choices=("unclaimed", "claimed_by_me", "claimed_by_another"))
    )
    def get_claim_status(self, submission: Submission) -> str:
        claim = self._active_claim(submission)
        if claim is None:
            return "unclaimed"
        request = self.context.get("request")
        return (
            "claimed_by_me"
            if request and claim.operator_id == request.user.id
            else "claimed_by_another"
        )

    @extend_schema_field(ReviewClaimSerializer(allow_null=True))
    def get_claim(self, submission: Submission) -> dict[str, Any] | None:
        claim = self._active_claim(submission)
        return dict(ReviewClaimSerializer(claim).data) if claim else None


class AvailabilityOutputSerializer(serializers.Serializer[dict[str, object]]):
    state = serializers.CharField()
    confirmed_at = serializers.DateTimeField(allow_null=True)
    available_until = serializers.DateTimeField(allow_null=True)
    expiring_soon = serializers.BooleanField()


class SubmissionSerializer(ClaimStatusMixin, serializers.ModelSerializer[Submission]):
    location = serializers.SerializerMethodField()
    property_facts = serializers.SerializerMethodField()
    rental_terms = serializers.SerializerMethodField()
    features = serializers.SerializerMethodField()
    contact = serializers.SerializerMethodField()
    review = serializers.JSONField(source="review_data")
    images = SubmissionImageSerializer(many=True, read_only=True)
    history = serializers.SerializerMethodField()
    available_actions = serializers.SerializerMethodField()
    listing_id = serializers.UUIDField(read_only=True, allow_null=True)
    property_id = serializers.UUIDField(
        source="listing.property_id", read_only=True, allow_null=True
    )
    source_id = serializers.UUIDField(read_only=True, allow_null=True)
    availability = serializers.SerializerMethodField()
    claim_status = serializers.SerializerMethodField()
    claim = serializers.SerializerMethodField()
    notification = serializers.SerializerMethodField()

    class Meta:
        model = Submission
        fields = (
            "id",
            "role",
            "state",
            "revision",
            "source_id",
            "listing_id",
            "property_id",
            "current_step",
            "media_complete",
            "images",
            "location",
            "property_facts",
            "rental_terms",
            "features",
            "description",
            "contact",
            "review",
            "pending_since",
            "claim_status",
            "claim",
            "history",
            "notification",
            "available_actions",
            "availability",
            "created_at",
            "updated_at",
        )

    @extend_schema_field(SubmissionEventSerializer(many=True))
    def get_history(self, submission: Submission) -> list[dict[str, Any]]:
        return list(SubmissionEventSerializer(submission.events.all(), many=True).data)

    @extend_schema_field(SubmissionDecisionNotificationSerializer(allow_null=True))
    def get_notification(self, submission: Submission) -> dict[str, Any] | None:
        for event in reversed(list(submission.events.all())):
            notification = getattr(event, "notification", None)
            if notification is not None:
                return dict(SubmissionDecisionNotificationSerializer(notification).data)
        return None

    def get_available_actions(self, submission: Submission) -> list[str]:
        if submission.state == SubmissionState.DRAFT:
            return ["edit", "submit"]
        if submission.state == SubmissionState.PUBLISHED:
            listing = submission.listing
            if listing is None:
                return ["edit"]
            if listing.state == ListingState.PUBLISHED:
                return ["edit", "confirm_availability", "mark_unavailable", "archive"]
            if listing.state == ListingState.EXPIRED:
                return ["edit", "confirm_availability", "archive"]
            if listing.state == ListingState.UNAVAILABLE:
                return ["edit", "archive"]
            return []
        if submission.state == SubmissionState.CHANGES_REQUESTED:
            return ["edit"]
        return []

    @extend_schema_field(AvailabilityOutputSerializer(allow_null=True))
    def get_availability(self, submission: Submission) -> dict[str, object] | None:
        listing = submission.listing
        if listing is None:
            return None
        now = timezone.now()
        return dict(
            AvailabilityOutputSerializer({
                "state": listing.state,
                "confirmed_at": listing.availability_confirmed_at,
                "available_until": listing.available_until,
                "expiring_soon": (
                    listing.state == ListingState.PUBLISHED
                    and listing.available_until is not None
                    and now < listing.available_until <= now + timedelta(days=7)
                ),
            }).data
        )

    @extend_schema_field(LocationOutputSerializer(allow_null=True))
    def get_location(self, submission: Submission) -> dict[str, Any] | None:
        if (
            submission.city is None
            or submission.district is None
            or submission.neighborhood is None
        ):
            return None
        return {
            "city_id": submission.city_id,
            "city": submission.city.name_fa,
            "district_id": submission.district_id,
            "district": submission.district.name_fa,
            "neighborhood_id": submission.neighborhood_id,
            "neighborhood": submission.neighborhood.name_fa,
            "address": submission.address,
        }

    @extend_schema_field(PropertyFactsInputSerializer(allow_null=True))
    def get_property_facts(self, submission: Submission) -> dict[str, Any] | None:
        if not submission.property_type:
            return None
        return {
            field: getattr(submission, field)
            for field in (
                "property_type",
                "area_sqm",
                "room_count",
                "construction_year",
                "floor",
                "total_floors",
                "units_per_floor",
            )
        }

    @extend_schema_field(RentalTermsOutputSerializer(allow_null=True))
    def get_rental_terms(self, submission: Submission) -> dict[str, Any] | None:
        if submission.deposit_rial is None or submission.monthly_rent_rial is None:
            return None
        return {
            "deposit_rial": submission.deposit_rial,
            "monthly_rent_rial": submission.monthly_rent_rial,
            "currency": "IRR",
            "deposit_toman": rial_to_toman(submission.deposit_rial),
            "monthly_rent_toman": rial_to_toman(submission.monthly_rent_rial),
            "is_negotiable": submission.is_negotiable,
            "is_convertible": submission.is_convertible,
        }

    @extend_schema_field(FeaturesInputSerializer)
    def get_features(self, submission: Submission) -> dict[str, str]:
        return {
            field: getattr(submission, field)
            for field in ("parking", "elevator", "storage", "balcony", "furnished")
        }

    @extend_schema_field(ContactOutputSerializer(allow_null=True))
    def get_contact(self, submission: Submission) -> dict[str, Any] | None:
        if not submission.contact_name:
            return None
        return {
            "name": submission.contact_name,
            "phone": submission.contact_phone,
            "authorization_declared": submission.authorization_declared,
            "phone_publication_consent": submission.phone_publication_consent,
        }


class StrictSerializer(serializers.Serializer[Any]):
    def to_internal_value(self, data: Any) -> dict[str, Any]:
        if isinstance(data, Mapping):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({
                    field: "این فیلد در تصمیم Submission قابل تغییر نیست."
                    for field in sorted(unknown)
                })
        return cast(dict[str, Any], super().to_internal_value(data))


class ReviewReasonSerializer(StrictSerializer):
    reviewed_revision = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(
        trim_whitespace=True,
        error_messages={"required": REQUIRED_ERROR, "blank": "دلیل تصمیم الزامی است."},
    )


class NormalizedPropertySerializer(StrictSerializer):
    city_id = serializers.UUIDField(required=False)
    district_id = serializers.UUIDField(required=False)
    neighborhood_id = serializers.UUIDField(required=False)
    property_type = serializers.ChoiceField(choices=PropertyType.choices, required=False)
    area_sqm = serializers.IntegerField(min_value=1, required=False)
    room_count = serializers.IntegerField(min_value=0, required=False)
    construction_year = serializers.IntegerField(min_value=1200, allow_null=True, required=False)
    floor = serializers.IntegerField(allow_null=True, required=False)
    total_floors = serializers.IntegerField(min_value=1, allow_null=True, required=False)
    units_per_floor = serializers.IntegerField(min_value=1, allow_null=True, required=False)
    parking = serializers.ChoiceField(choices=FeatureState.choices, required=False)
    elevator = serializers.ChoiceField(choices=FeatureState.choices, required=False)
    storage = serializers.ChoiceField(choices=FeatureState.choices, required=False)
    balcony = serializers.ChoiceField(choices=FeatureState.choices, required=False)
    furnished = serializers.ChoiceField(choices=FeatureState.choices, required=False)
    operator_location_notes = serializers.CharField(allow_blank=True, required=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        relations = (
            ("city_id", "city", City),
            ("district_id", "district", District),
            ("neighborhood_id", "neighborhood", Neighborhood),
        )
        for input_name, model_name, model in relations:
            if input_name in attrs:
                try:
                    attrs[model_name] = model.objects.get(id=attrs.pop(input_name), reviewed=True)
                except model.DoesNotExist:
                    raise serializers.ValidationError({
                        input_name: "مکان بازبینی‌شده پیدا نشد."
                    }) from None
        return attrs


class SourceMetadataSerializer(StrictSerializer):
    source_reference = serializers.CharField(max_length=255, allow_blank=True, required=False)
    source_claims = serializers.JSONField(required=False)
    provenance_note = serializers.CharField(allow_blank=True, required=False)


class FormattingSerializer(StrictSerializer):
    description = serializers.CharField(max_length=5000, allow_blank=True, required=False)


class SubmissionApprovalSerializer(StrictSerializer):
    reviewed_revision = serializers.IntegerField(min_value=1)
    property_id = serializers.UUIDField(required=False, allow_null=True)
    normalized_property = NormalizedPropertySerializer(required=False)
    source_metadata = SourceMetadataSerializer(required=False)
    formatting = FormattingSerializer(required=False)
    internal_note = serializers.CharField(allow_blank=True, required=False)


class OperatorSubmissionQueueSerializer(ClaimStatusMixin, serializers.ModelSerializer[Submission]):
    location = serializers.SerializerMethodField()
    claim_status = serializers.SerializerMethodField()
    claim = serializers.SerializerMethodField()

    class Meta:
        model = Submission
        fields = (
            "id",
            "role",
            "state",
            "revision",
            "source_id",
            "location",
            "pending_since",
            "claim_status",
            "claim",
        )

    @extend_schema_field(LocationOutputSerializer(allow_null=True))
    def get_location(self, submission: Submission) -> dict[str, Any] | None:
        if not submission.city or not submission.district or not submission.neighborhood:
            return None
        return {
            "city_id": submission.city_id,
            "city": submission.city.name_fa,
            "district_id": submission.district_id,
            "district": submission.district.name_fa,
            "neighborhood_id": submission.neighborhood_id,
            "neighborhood": submission.neighborhood.name_fa,
            "address": submission.address,
        }


class ForceReleaseReviewClaimSerializer(serializers.Serializer[Any]):
    reason = serializers.CharField(
        trim_whitespace=True,
        error_messages={"required": REQUIRED_ERROR, "blank": "دلیل آزادسازی الزامی است."},
    )
