import uuid
from typing import ClassVar

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.utils.text import slugify

from apps.common.media import MediaVariantKind

from .money import rial_to_toman

TEHRAN_CITY_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")


class PropertyCategory(models.TextChoices):
    RESIDENTIAL = "residential", "مسکونی"
    COMMERCIAL = "commercial", "تجاری"


class PropertyType(models.TextChoices):
    APARTMENT = "apartment", "آپارتمان"
    HOUSE = "house", "خانه"
    VILLA = "villa", "ویلا"
    OFFICE = "office", "دفتر اداری"
    SHOP = "shop", "مغازه"
    WAREHOUSE = "warehouse", "انبار"
    WORKSHOP = "workshop", "کارگاه"


PROPERTY_TYPES_BY_CATEGORY: dict[PropertyCategory, tuple[PropertyType, ...]] = {
    PropertyCategory.RESIDENTIAL: (
        PropertyType.APARTMENT,
        PropertyType.HOUSE,
        PropertyType.VILLA,
    ),
    PropertyCategory.COMMERCIAL: (
        PropertyType.OFFICE,
        PropertyType.SHOP,
        PropertyType.WAREHOUSE,
        PropertyType.WORKSHOP,
    ),
}


def property_category_for_type(property_type: str | PropertyType) -> PropertyCategory:
    normalized_type = PropertyType(property_type)
    for category, property_types in PROPERTY_TYPES_BY_CATEGORY.items():
        if normalized_type in property_types:
            return category
    raise ValueError(f"Property Type {normalized_type!r} has no Property Category")


def property_type_requires_room_count(property_type: str | PropertyType) -> bool:
    return property_category_for_type(property_type) == PropertyCategory.RESIDENTIAL


class FeatureState(models.TextChoices):
    UNKNOWN = "unknown", "نامشخص"
    PRESENT = "present", "دارد"
    ABSENT = "absent", "ندارد"


class OutboundPolicy(models.TextChoices):
    DIRECT_CONTACT = "direct_contact", "تماس مستقیم"
    EXTERNAL_LINK = "external_link", "پیوند منبع"
    DISABLED = "disabled", "غیرفعال"


class LocationPrecision(models.TextChoices):
    APPROXIMATE = "approximate", "Approximate"
    NEIGHBORHOOD = "neighborhood", "Neighborhood"


class ProvenancedLocation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name_fa = models.CharField(max_length=120)
    source_code = models.CharField(max_length=64)
    source_year = models.PositiveSmallIntegerField()
    provenance_url = models.URLField(max_length=500)
    imported_at = models.DateField()
    reviewed = models.BooleanField(default=False)

    class Meta:
        abstract = True

    def __str__(self) -> str:
        return self.name_fa


class City(ProvenancedLocation):
    class Meta:
        verbose_name_plural = "cities"


class District(ProvenancedLocation):
    city = models.ForeignKey(City, on_delete=models.PROTECT, related_name="districts")
    number = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ("number",)
        constraints = [
            models.UniqueConstraint(fields=("city", "number"), name="catalog_unique_district")
        ]


class Neighborhood(ProvenancedLocation):
    district = models.ForeignKey(District, on_delete=models.PROTECT, related_name="neighborhoods")
    center_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    center_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    class Meta:
        ordering = ("name_fa",)
        constraints = [
            models.UniqueConstraint(
                fields=("district", "name_fa"), name="catalog_unique_neighborhood"
            )
        ]


class Source(models.Model):
    processing_paused = models.BooleanField(default=False, db_default=False)
    processing_revision = models.PositiveIntegerField(default=0, db_default=0)
    crawl_interval_hours = models.PositiveIntegerField(default=0, db_default=0)
    crawl_schedule_revision = models.PositiveIntegerField(default=0, db_default=0)
    next_crawl_at = models.DateTimeField(null=True, blank=True)
    crawl_schedule_error = models.TextField(blank=True, default="", db_default="")
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120, unique=True)
    domain = models.CharField(max_length=253, unique=True)
    display_name = models.CharField(max_length=120)
    is_active = models.BooleanField(default=True)
    is_builtin = models.BooleanField(default=False)
    outbound_policy = models.CharField(max_length=24, choices=OutboundPolicy)
    allows_external_media = models.BooleanField(default=False)
    responsible_operator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="responsible_sources",
    )
    responsibility_revision = models.PositiveIntegerField(default=0, db_default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("is_builtin",),
                condition=Q(is_builtin=True),
                name="catalog_single_builtin_source",
            )
        ]

    def __str__(self) -> str:
        return self.display_name


class Property(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    city = models.ForeignKey(
        City, on_delete=models.PROTECT, related_name="properties", null=True, blank=True
    )
    district = models.ForeignKey(
        District, on_delete=models.PROTECT, related_name="properties", null=True, blank=True
    )
    neighborhood = models.ForeignKey(
        Neighborhood, on_delete=models.PROTECT, related_name="properties", null=True, blank=True
    )
    property_type = models.CharField(max_length=16, choices=PropertyType, blank=True)
    area_sqm = models.PositiveIntegerField(null=True, blank=True)
    room_count = models.PositiveSmallIntegerField(null=True, blank=True)
    construction_year = models.PositiveSmallIntegerField(null=True, blank=True)
    floor = models.SmallIntegerField(null=True, blank=True)
    total_floors = models.PositiveSmallIntegerField(null=True, blank=True)
    units_per_floor = models.PositiveSmallIntegerField(null=True, blank=True)
    parking = models.CharField(max_length=8, choices=FeatureState, default=FeatureState.UNKNOWN)
    elevator = models.CharField(max_length=8, choices=FeatureState, default=FeatureState.UNKNOWN)
    storage = models.CharField(max_length=8, choices=FeatureState, default=FeatureState.UNKNOWN)
    balcony = models.CharField(max_length=8, choices=FeatureState, default=FeatureState.UNKNOWN)
    furnished = models.CharField(max_length=8, choices=FeatureState, default=FeatureState.UNKNOWN)
    heating = models.CharField(max_length=120, blank=True)
    cooling = models.CharField(max_length=120, blank=True)
    operator_location_notes = models.TextField(blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    approximate_latitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True, editable=False
    )
    approximate_longitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True, editable=False
    )
    location_precision = models.CharField(
        max_length=16,
        choices=LocationPrecision,
        blank=True,
        editable=False,
    )
    location_radius_meters = models.PositiveIntegerField(null=True, blank=True, editable=False)
    provenance_note = models.TextField(blank=True)
    normalized_at = models.DateTimeField(null=True, blank=True)
    merged_into = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        related_name="merged_properties",
        null=True,
        blank=True,
        editable=False,
    )
    merged_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        permissions = (("curate_catalog", "Can curate the Property catalog"),)
        indexes = [
            models.Index(fields=("latitude", "longitude"), name="catalog_prop_coords"),
            models.Index(
                fields=("city", "property_type", "area_sqm"),
                name="catalog_prop_city_facts",
            ),
            models.Index(
                fields=("neighborhood", "property_type", "area_sqm"),
                name="catalog_prop_neigh_facts",
            ),
            models.Index(
                fields=("total_floors", "units_per_floor"),
                name="catalog_prop_build_facts",
            ),
            models.Index(
                fields=("floor", "construction_year"),
                name="catalog_prop_floor_year",
            ),
        ]

    def __str__(self) -> str:
        if self.property_type and self.neighborhood_id:
            return self.title
        return str(self.id)

    def clean(self) -> None:
        super().clean()
        errors: dict[str, str] = {}
        required = {
            "city": self.city_id,
            "district": self.district_id,
            "neighborhood": self.neighborhood_id,
            "property_type": self.property_type,
            "area_sqm": self.area_sqm,
        }
        for field, value in required.items():
            if value in (None, ""):
                errors[field] = "این مقدار برای انتشار الزامی است."
        if self.area_sqm is not None and self.area_sqm == 0:
            errors["area_sqm"] = "متراژ باید بیشتر از صفر باشد."
        if (
            self.room_count is None
            and self.property_type in PropertyType.values
            and property_type_requires_room_count(self.property_type)
        ):
            errors["room_count"] = "این مقدار برای انتشار الزامی است."
        district = self.district
        neighborhood = self.neighborhood
        if district is not None and self.city_id and district.city_id != self.city_id:
            errors["district"] = "منطقه باید متعلق به شهر انتخاب‌شده باشد."
        if (
            neighborhood is not None
            and self.district_id
            and neighborhood.district_id != self.district_id
        ):
            errors["neighborhood"] = "محله باید متعلق به منطقه انتخاب‌شده باشد."
        location_parts = (self.city, district, neighborhood)
        if any(part is not None and not part.reviewed for part in location_parts):
            errors["neighborhood"] = "برای انتشار باید مکان بازبینی‌شده انتخاب شود."
        if self.city_id is not None and self.city_id != TEHRAN_CITY_ID:
            errors["city"] = "در این مرحله فقط شهر تهران قابل انتشار است."
        if errors:
            raise ValidationError(errors)

    @property
    def title(self) -> str:
        property_type = PropertyType(self.property_type).label
        neighborhood = self.neighborhood
        if neighborhood is None:
            return str(property_type)
        return f"{property_type} در {neighborhood.name_fa}"

    @property
    def property_category(self) -> PropertyCategory:
        return property_category_for_type(self.property_type)

    @property
    def property_category_label(self) -> str:
        return self.property_category.label

    @property
    def canonical_slug(self) -> str:
        return slugify(self.title, allow_unicode=True)


class Favorite(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="favorites",
    )
    property = models.ForeignKey(
        Property,
        on_delete=models.CASCADE,
        related_name="favorites",
    )
    saved_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-saved_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("account", "property"),
                name="catalog_unique_favorite_per_account_property",
            )
        ]

    def __str__(self) -> str:
        return f"{self.account_id}: {self.property_id}"


class RentalTerms(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    deposit_rial = models.PositiveBigIntegerField()
    monthly_rent_rial = models.PositiveBigIntegerField()
    currency = models.CharField(
        max_length=3,
        choices=(("IRR", "ریال ایران"),),
        default="IRR",
        editable=False,
    )
    is_negotiable = models.BooleanField(default=False)
    is_convertible = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(deposit_rial__gt=0) | Q(monthly_rent_rial__gt=0),
                name="catalog_rental_terms_nonzero",
            ),
            models.CheckConstraint(
                condition=Q(currency="IRR"),
                name="catalog_rental_terms_irr",
            ),
        ]

    def __str__(self) -> str:
        deposit_toman = rial_to_toman(self.deposit_rial)
        monthly_rent_toman = rial_to_toman(self.monthly_rent_rial)
        return f"{deposit_toman:,} / {monthly_rent_toman:,} تومان"

    def clean(self) -> None:
        super().clean()
        if self.deposit_rial == 0 and self.monthly_rent_rial == 0:
            raise ValidationError("رهن و اجاره ماهانه نمی‌توانند هم‌زمان صفر باشند.")


class ListingState(models.TextChoices):
    DRAFT = "draft", "پیش‌نویس"
    PENDING = "pending", "در انتظار بررسی"
    PUBLISHED = "published", "منتشرشده"
    EXPIRED = "expired", "منقضی‌شده"
    REJECTED = "rejected", "ردشده"
    UNAVAILABLE = "unavailable", "ناموجود"
    ARCHIVED = "archived", "بایگانی‌شده"


class ActiveListingQuerySet(models.QuerySet["Listing"]):
    def active(self) -> ActiveListingQuerySet:
        return self.filter(
            state=ListingState.PUBLISHED,
            available_until__gt=timezone.now(),
            source__is_active=True,
        )


class ActiveListingManager(models.Manager["Listing"]):
    def get_queryset(self) -> ActiveListingQuerySet:
        return ActiveListingQuerySet(self.model, using=self._db)

    def active(self) -> ActiveListingQuerySet:
        return self.get_queryset().active()


class Listing(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property = models.ForeignKey(Property, on_delete=models.PROTECT, related_name="listings")
    source = models.ForeignKey(Source, on_delete=models.PROTECT, related_name="listings")
    terms = models.OneToOneField(RentalTerms, on_delete=models.PROTECT, related_name="listing")
    state = models.CharField(max_length=16, choices=ListingState, default=ListingState.DRAFT)
    description = models.TextField(blank=True)
    source_reference = models.CharField(max_length=255, blank=True)
    source_claims = models.JSONField(default=dict, blank=True)
    provenance_note = models.TextField(blank=True)
    external_url = models.URLField(max_length=1000, blank=True)
    external_media_url = models.URLField(max_length=1000, blank=True)
    direct_phone = models.CharField(max_length=32, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    availability_confirmed_at = models.DateTimeField(null=True, blank=True)
    available_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects: ClassVar[ActiveListingManager] = ActiveListingManager()

    class Meta:
        ordering = ("-availability_confirmed_at", "id")

    def __str__(self) -> str:
        return f"{self.source.display_name}: {self.property}"

    def clean(self) -> None:
        super().clean()
        errors: dict[str, str] = {}
        if not self.source.is_active:
            errors["source"] = "منبع غیرفعال قابل انتشار نیست."
        if self.source.outbound_policy == OutboundPolicy.EXTERNAL_LINK and not self.external_url:
            errors["external_url"] = "پیوند آگهی برای این منبع الزامی است."
        if self.source.outbound_policy == OutboundPolicy.DIRECT_CONTACT and not self.direct_phone:
            errors["direct_phone"] = "شماره تماس مستقیم الزامی است."
        if errors:
            raise ValidationError(errors)


class ListingImage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="images")
    position = models.PositiveSmallIntegerField()
    is_primary = models.BooleanField(default=False)
    raw_content_sha256 = models.CharField(max_length=64, blank=True, db_index=True)
    normalized_pixel_sha256 = models.CharField(max_length=64, blank=True, db_index=True)
    perceptual_dhash = models.CharField(max_length=16, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("position",)
        constraints = [
            models.UniqueConstraint(
                fields=("listing", "position"),
                name="unique_listing_image_position",
            ),
            models.UniqueConstraint(
                fields=("listing",),
                condition=Q(is_primary=True),
                name="one_primary_image_per_listing",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.listing_id}: {self.position}"


class ListingImagePerceptualBucket(models.Model):
    image = models.ForeignKey(
        ListingImage,
        on_delete=models.CASCADE,
        related_name="perceptual_buckets",
    )
    position = models.PositiveSmallIntegerField()
    value = models.CharField(max_length=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("image", "position"),
                name="catalog_unique_listing_image_dhash_bucket",
            )
        ]
        indexes = [
            models.Index(
                fields=("position", "value"),
                name="catalog_dhash_bucket_lookup",
            )
        ]

    def __str__(self) -> str:
        return f"{self.image_id}: {self.position}={self.value}"


class ListingImageVariant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    image = models.ForeignKey(ListingImage, on_delete=models.CASCADE, related_name="variants")
    kind = models.CharField(max_length=8, choices=MediaVariantKind)
    asset = models.ForeignKey(
        "common.MediaAsset",
        on_delete=models.PROTECT,
        related_name="listing_variants",
    )

    class Meta:
        ordering = ("kind",)
        constraints = [
            models.UniqueConstraint(
                fields=("image", "kind"),
                name="unique_listing_image_variant",
            )
        ]

    def __str__(self) -> str:
        return f"{self.image_id}: {self.kind}"


class PropertyImage(models.Model):
    """An Operator-reviewed image normalized onto a Property."""

    retired_at = models.DateTimeField(null=True, blank=True, editable=False)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="images")
    position = models.PositiveSmallIntegerField()
    is_primary = models.BooleanField(default=False)
    reviewed_at = models.DateTimeField()
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="reviewed_property_images",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("position",)
        constraints = [
            models.UniqueConstraint(
                fields=("property", "position"),
                condition=Q(retired_at__isnull=True),
                name="unique_property_image_position",
            ),
            models.UniqueConstraint(
                fields=("property",),
                condition=Q(is_primary=True, retired_at__isnull=True),
                name="one_primary_image_per_property",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.property_id}: {self.position}"


class PropertyImageVariant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    image = models.ForeignKey(PropertyImage, on_delete=models.CASCADE, related_name="variants")
    kind = models.CharField(max_length=8, choices=MediaVariantKind)
    asset = models.ForeignKey(
        "common.MediaAsset",
        on_delete=models.PROTECT,
        related_name="property_variants",
    )

    class Meta:
        ordering = ("kind",)
        constraints = [
            models.UniqueConstraint(
                fields=("image", "kind"),
                name="unique_property_image_variant",
            )
        ]

    def __str__(self) -> str:
        return f"{self.image_id}: {self.kind}"


class ProductEventType(models.TextChoices):
    PROPERTY_VIEW = "property_view", "بازدید ملک"
    EXTERNAL_CONTINUATION = "external_continuation", "ادامه در منبع بیرونی"
    PHONE_REVEAL = "phone_reveal", "نمایش شماره تماس"


class ProductEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=24, choices=ProductEventType)
    property = models.ForeignKey(Property, on_delete=models.PROTECT, related_name="product_events")
    listing = models.ForeignKey(
        Listing,
        on_delete=models.PROTECT,
        related_name="product_events",
        null=True,
        blank=True,
    )
    source = models.ForeignKey(
        Source,
        on_delete=models.PROTECT,
        related_name="product_events",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "id")

    def __str__(self) -> str:
        return f"{self.get_event_type_display()}: {self.property_id}"


class ListingGroupingAction(models.TextChoices):
    ATTACH = "attach", "اتصال"
    SPLIT = "split", "تفکیک"
    MERGE = "merge", "ادغام"


class ListingGroupingEvent(models.Model):
    decision = models.ForeignKey(
        "PropertyMatchDecision",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="grouping_events",
    )
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT, related_name="grouping_events")
    from_property = models.ForeignKey(
        Property, on_delete=models.PROTECT, related_name="outgoing_grouping_events"
    )
    to_property = models.ForeignKey(
        Property, on_delete=models.PROTECT, related_name="incoming_grouping_events"
    )
    action = models.CharField(max_length=12, choices=ListingGroupingAction)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"{self.get_action_display()}: {self.listing_id}"


class ListingPriceObservation(models.Model):
    """A paired price observed while a listing is published, never a backdated estimate."""

    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="price_history")
    recorded_at = models.DateTimeField(default=timezone.now, editable=False)
    deposit_rial = models.PositiveBigIntegerField()
    monthly_rent_rial = models.PositiveBigIntegerField()

    class Meta:
        ordering = ("recorded_at", "id")

    def __str__(self) -> str:
        return f"{self.listing_id}: {self.recorded_at.isoformat()}"


class PropertyMatchClaim(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    left = models.ForeignKey(Property, on_delete=models.PROTECT, related_name="left_match_claims")
    right = models.ForeignKey(Property, on_delete=models.PROTECT, related_name="right_match_claims")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    suggestion = models.ForeignKey(
        "PropertyMatchSuggestion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="claims",
    )
    expires_at = models.DateTimeField()

    def __str__(self) -> str:
        return f"{self.left_id} / {self.right_id}: {self.actor_id}"


class PropertyMatchDecision(models.Model):
    class Outcome(models.TextChoices):
        SAME_PROPERTY = "same_property", "یک ملک"
        NOT_SAME_PROPERTY = "not_same_property", "دو ملک متفاوت"
        SNOOZED = "snoozed", "تعویق"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    claim = models.OneToOneField(PropertyMatchClaim, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    origin = models.CharField(max_length=24, default="operator_initiated", editable=False)
    outcome = models.CharField(
        max_length=24,
        choices=Outcome,
        default=Outcome.SAME_PROPERTY,
    )
    suggestion = models.ForeignKey(
        "PropertyMatchSuggestion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="decisions",
    )
    evaluation = models.ForeignKey(
        "PropertyMatchSuggestionEvaluation",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="decisions",
    )
    evaluation_snapshot = models.JSONField(default=dict, blank=True)
    survivor = models.ForeignKey(
        Property,
        on_delete=models.PROTECT,
        related_name="match_decisions",
        null=True,
        blank=True,
    )
    redundant = models.ForeignKey(
        Property,
        on_delete=models.PROTECT,
        related_name="redundant_decisions",
        null=True,
        blank=True,
    )
    before_revision = models.CharField(max_length=64)
    after_revision = models.CharField(max_length=64)
    evidence = models.JSONField()
    after_snapshot = models.JSONField()
    selected_facts = models.JSONField()
    selected_image_ids = models.JSONField()
    affected_listing_ids = models.JSONField()
    request_digest = models.CharField(max_length=64)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        if self.survivor_id is None or self.redundant_id is None:
            return f"{self.get_outcome_display()}: {self.suggestion_id}"
        return f"{self.redundant_id} → {self.survivor_id}"


class PropertyMatchSuggestionState(models.TextChoices):
    PENDING = "pending", "در انتظار بررسی"
    APPROVED = "approved", "تأییدشده"
    REJECTED = "rejected", "ردشده"
    SNOOZED = "snoozed", "به تعویق افتاده"
    SUPERSEDED = "superseded", "جایگزین‌شده"


class PropertyMatchSuggestionOrigin(models.TextChoices):
    FOCUSED = "focused", "سنجش متمرکز"
    NIGHTLY = "nightly", "آشتی شبانه"
    RESCORE = "rescore", "امتیازدهی دوباره"


class PropertyMatchSuggestion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    left = models.ForeignKey(
        Property, on_delete=models.PROTECT, related_name="left_match_suggestions"
    )
    right = models.ForeignKey(
        Property, on_delete=models.PROTECT, related_name="right_match_suggestions"
    )
    rebased_to = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="rebased_from",
    )
    state = models.CharField(
        max_length=16,
        choices=PropertyMatchSuggestionState,
        default=PropertyMatchSuggestionState.PENDING,
    )
    score = models.PositiveSmallIntegerField()
    band = models.CharField(max_length=16)
    scoring_version = models.CharField(max_length=64)
    evidence_fingerprint = models.CharField(max_length=64)
    left_revision = models.CharField(max_length=64)
    right_revision = models.CharField(max_length=64)
    evidence = models.JSONField()
    origin = models.CharField(max_length=16, choices=PropertyMatchSuggestionOrigin)
    suppressed_evidence_fingerprint = models.CharField(max_length=64, blank=True)
    snoozed_until = models.DateTimeField(null=True, blank=True)
    first_suggested_at = models.DateTimeField(default=timezone.now)
    last_evaluated_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-score", "first_suggested_at", "id")
        constraints = [
            models.CheckConstraint(
                condition=Q(left_id__lt=models.F("right_id")),
                name="catalog_match_suggestion_ordered_pair",
            ),
            models.UniqueConstraint(
                fields=("left", "right"),
                name="catalog_unique_match_suggestion_pair",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.left_id} / {self.right_id}: {self.score}"


class PropertyMatchSuggestionEvaluation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    suggestion = models.ForeignKey(
        PropertyMatchSuggestion, on_delete=models.PROTECT, related_name="evaluations"
    )
    score = models.PositiveSmallIntegerField()
    band = models.CharField(max_length=16)
    scoring_version = models.CharField(max_length=64)
    evidence_fingerprint = models.CharField(max_length=64)
    left_revision = models.CharField(max_length=64)
    right_revision = models.CharField(max_length=64)
    evidence = models.JSONField()
    origin = models.CharField(max_length=16, choices=PropertyMatchSuggestionOrigin)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"{self.suggestion_id}: {self.score}"


class PropertyGroupConsistencyMeasurement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property = models.ForeignKey(
        Property,
        on_delete=models.PROTECT,
        related_name="consistency_measurements",
    )
    group_revision = models.CharField(max_length=64)
    scoring_version = models.CharField(max_length=64)
    listing_count = models.PositiveIntegerField()
    pair_measurements = models.JSONField(default=list)
    strongest_pair = models.JSONField(null=True, blank=True)
    weakest_pair = models.JSONField(null=True, blank=True)
    explicit_contradictions = models.JSONField(default=list)
    needs_attention = models.BooleanField(default=False)
    measured_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-measured_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("property", "group_revision", "scoring_version"),
                name="catalog_unique_group_consistency_measurement",
            )
        ]

    def __str__(self) -> str:
        return f"{self.property_id}: {self.scoring_version}"
