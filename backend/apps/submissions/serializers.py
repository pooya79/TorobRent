from dataclasses import dataclass
from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import UploadedFile
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.catalog.models import FeatureState, Neighborhood, PropertyType
from apps.catalog.money import rial_to_toman
from apps.catalog.serializers import LocalizedIntegerField, TomanRialField

from .models import (
    Submission,
    SubmissionImage,
    SubmissionImageVariant,
    SubmissionStep,
    SubmitterRole,
)

MAX_SAFE_TOMAN_FOR_JSON_RIAL = 900_719_925_474_099


@dataclass(frozen=True)
class StepDefinition:
    section: str
    successor: SubmissionStep
    fields: tuple[str, ...] = ()


STEP_DEFINITIONS = {
    SubmissionStep.LOCATION: StepDefinition(
        "location",
        SubmissionStep.PROPERTY_FACTS,
        ("city", "district", "neighborhood", "address"),
    ),
    SubmissionStep.PROPERTY_FACTS: StepDefinition(
        "property_facts",
        SubmissionStep.RENTAL_TERMS,
        (
            "property_type",
            "area_sqm",
            "room_count",
            "construction_year",
            "floor",
            "total_floors",
            "units_per_floor",
        ),
    ),
    SubmissionStep.RENTAL_TERMS: StepDefinition(
        "rental_terms",
        SubmissionStep.FEATURES_DESCRIPTION,
        ("deposit_rial", "monthly_rent_rial", "is_negotiable", "is_convertible"),
    ),
    SubmissionStep.FEATURES_DESCRIPTION: StepDefinition(
        "features",
        SubmissionStep.IMAGES,
        ("parking", "elevator", "storage", "balcony", "furnished"),
    ),
    SubmissionStep.IMAGES: StepDefinition("images", SubmissionStep.CONTACT),
    SubmissionStep.CONTACT: StepDefinition("contact", SubmissionStep.REVIEW),
    SubmissionStep.REVIEW: StepDefinition("review", SubmissionStep.REVIEW),
}
STEP_ORDER = tuple(SubmissionStep.values)
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

    def update(self, instance: Submission, validated_data: dict[str, Any]) -> Submission:
        step = validated_data.pop("completed_step")
        definition = STEP_DEFINITIONS[step]
        values = validated_data.get(definition.section)
        if values is not None:
            if definition.section == "location":
                values.pop("city_id", None)
                values.pop("district_id", None)
                values.pop("neighborhood_id")
            for field in definition.fields:
                if field in values:
                    setattr(instance, field, values[field])
        contact = validated_data.get("contact")
        if contact is not None:
            instance.contact_name = contact["name"]
            instance.contact_phone = contact["phone"]
            instance.authorization_declared = contact["authorization_declared"]
            instance.phone_publication_consent = contact["phone_publication_consent"]
        if "description" in validated_data:
            instance.description = validated_data["description"]
        if "review" in validated_data:
            instance.review_data = validated_data["review"]
        if STEP_ORDER.index(definition.successor) > STEP_ORDER.index(instance.current_step):
            instance.current_step = definition.successor
        instance.save()
        return instance


class SubmissionSerializer(serializers.ModelSerializer[Submission]):
    location = serializers.SerializerMethodField()
    property_facts = serializers.SerializerMethodField()
    rental_terms = serializers.SerializerMethodField()
    features = serializers.SerializerMethodField()
    contact = serializers.SerializerMethodField()
    review = serializers.JSONField(source="review_data")
    images = SubmissionImageSerializer(many=True, read_only=True)

    class Meta:
        model = Submission
        fields = (
            "id",
            "role",
            "state",
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
            "created_at",
            "updated_at",
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
