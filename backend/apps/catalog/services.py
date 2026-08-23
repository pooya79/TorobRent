from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .models import (
    Listing,
    ListingGroupingAction,
    ListingGroupingEvent,
    ListingImage,
    ListingImageVariant,
    ListingState,
    Property,
    RentalTerms,
    Source,
)


@dataclass(frozen=True)
class ListingImageVariantSpec:
    kind: str
    asset_id: UUID


@dataclass(frozen=True)
class ListingImageSpec:
    position: int
    is_primary: bool
    variants: tuple[ListingImageVariantSpec, ...]


@dataclass(frozen=True)
class DirectListingSpec:
    source: Source
    property_values: Mapping[str, object]
    property_corrections: Mapping[str, object]
    terms_values: Mapping[str, object]
    listing_values: Mapping[str, object]
    image_specs: Sequence[ListingImageSpec]
    property_id: UUID | None = None
    existing_listing_id: UUID | None = None


@transaction.atomic
def publish_listing(listing: Listing) -> Listing:
    listing.property.full_clean()
    listing.terms.full_clean()
    listing.full_clean()
    now = timezone.now()
    listing.property.normalized_at = now
    listing.property.save(update_fields=["normalized_at"])
    if listing.published_at is None:
        listing.published_at = now
    listing.availability_confirmed_at = now
    listing.available_until = now + timedelta(days=30)
    listing.state = ListingState.PUBLISHED
    listing.save()
    return listing


@transaction.atomic
def confirm_listing_availability(listing: Listing) -> Listing:
    listing = Listing.objects.select_for_update().select_related("source").get(pk=listing.pk)
    if listing.state not in (ListingState.PUBLISHED, ListingState.EXPIRED):
        raise ValidationError("فقط آگهی منتشرشده یا منقضی قابل تأیید موجودی است.")
    listing.full_clean()
    now = timezone.now()
    listing.state = ListingState.PUBLISHED
    listing.availability_confirmed_at = now
    listing.available_until = now + timedelta(days=30)
    listing.save(
        update_fields=(
            "state",
            "availability_confirmed_at",
            "available_until",
            "updated_at",
        )
    )
    return listing


@transaction.atomic
def mark_listing_unavailable(listing: Listing) -> Listing:
    listing = Listing.objects.select_for_update().get(pk=listing.pk)
    if listing.state != ListingState.PUBLISHED:
        raise ValidationError("فقط آگهی منتشرشده را می‌توان ناموجود کرد.")
    listing.state = ListingState.UNAVAILABLE
    listing.save(update_fields=("state", "updated_at"))
    return listing


@transaction.atomic
def archive_listing(listing: Listing) -> Listing:
    listing = Listing.objects.select_for_update().get(pk=listing.pk)
    if listing.state == ListingState.ARCHIVED:
        return listing
    listing.state = ListingState.ARCHIVED
    listing.save(update_fields=("state", "updated_at"))
    return listing


def expire_listings() -> int:
    return Listing.objects.filter(
        state=ListingState.PUBLISHED,
        available_until__lte=timezone.now(),
    ).update(state=ListingState.EXPIRED)


@transaction.atomic
def materialize_direct_listing(*, spec: DirectListingSpec) -> Listing:
    existing_listing = None
    if spec.existing_listing_id is not None:
        existing_listing = (
            Listing.objects
            .select_for_update()
            .select_related("property", "terms")
            .get(id=spec.existing_listing_id)
        )

    if spec.property_id is not None:
        property_ = Property.objects.select_for_update().get(id=spec.property_id, merged_into=None)
        for field, value in spec.property_corrections.items():
            setattr(property_, field, value)
        if spec.property_corrections:
            property_.full_clean()
            property_.save()
    elif existing_listing is not None:
        property_ = existing_listing.property
        for field, value in spec.property_values.items():
            setattr(property_, field, value)
        property_.full_clean()
        property_.save()
    else:
        property_ = Property(**spec.property_values)
        property_.full_clean()
        property_.save()

    if existing_listing is None:
        terms = RentalTerms.objects.create(**spec.terms_values)
        listing = Listing.objects.create(
            property=property_,
            source=spec.source,
            terms=terms,
            **spec.listing_values,
        )
    else:
        terms = existing_listing.terms
        for field, value in spec.terms_values.items():
            setattr(terms, field, value)
        terms.full_clean()
        terms.save()
        listing = existing_listing
        listing.property = property_
        listing.source = spec.source
        for field, value in spec.listing_values.items():
            setattr(listing, field, value)
        listing.save()
    listing = publish_listing(listing)
    replace_listing_images(listing=listing, image_specs=spec.image_specs)
    return listing


@transaction.atomic
def replace_listing_images(
    *, listing: Listing, image_specs: Sequence[ListingImageSpec]
) -> list[ListingImage]:
    ListingImage.objects.filter(listing=listing).delete()
    retained: list[ListingImage] = []
    for image_spec in image_specs:
        listing_image = ListingImage.objects.create(
            listing=listing,
            position=image_spec.position,
            is_primary=image_spec.is_primary,
        )
        retained.append(listing_image)
        ListingImageVariant.objects.bulk_create([
            ListingImageVariant(
                image=listing_image,
                kind=variant.kind,
                asset_id=variant.asset_id,
            )
            for variant in image_spec.variants
        ])
    return retained


@transaction.atomic
def merge_properties(*, target: Property, duplicate: Property, reason: str = "") -> Property:
    if target.pk == duplicate.pk:
        raise ValidationError("ملک مقصد و تکراری باید متفاوت باشند.")

    locked_properties = {
        property_.pk: property_
        for property_ in Property.objects
        .select_for_update()
        .filter(pk__in=(target.pk, duplicate.pk))
        .order_by("pk")
    }
    target = locked_properties[target.pk]
    duplicate = locked_properties[duplicate.pk]
    if target.merged_into_id is not None:
        raise ValidationError("ملک مقصد قبلاً در ملک دیگری ادغام شده است.")
    if duplicate.merged_into_id is not None:
        raise ValidationError("ملک تکراری قبلاً ادغام شده است.")

    for listing in Listing.objects.select_for_update().filter(property=duplicate):
        listing.property = target
        listing.save(update_fields=["property", "updated_at"])
        ListingGroupingEvent.objects.create(
            listing=listing,
            from_property=duplicate,
            to_property=target,
            action=ListingGroupingAction.MERGE,
            reason=reason,
        )

    duplicate.merged_into = target
    duplicate.merged_at = timezone.now()
    duplicate.save(update_fields=["merged_into", "merged_at"])
    return target


def _locked_listing_and_property(
    *, listing: Listing, destination: Property
) -> tuple[Listing, Property]:
    listing = Listing.objects.select_for_update().get(pk=listing.pk)
    destination = Property.objects.select_for_update().get(pk=destination.pk)
    if listing.property_id == destination.pk:
        raise ValidationError("آگهی از قبل به این ملک متصل است.")
    return listing, destination


def _move_listing(
    *,
    listing: Listing,
    destination: Property,
    action: ListingGroupingAction,
    reason: str,
) -> Listing:
    original_property_id = listing.property_id
    listing.property = destination
    listing.save(update_fields=["property", "updated_at"])
    ListingGroupingEvent.objects.create(
        listing=listing,
        from_property_id=original_property_id,
        to_property=destination,
        action=action,
        reason=reason,
    )
    return listing


def _split_locked(*, listing: Listing, destination: Property, reason: str) -> Listing:
    if Listing.objects.filter(property=destination).exists():
        raise ValidationError("برای تفکیک، یک ملک جدا و بدون آگهی انتخاب کنید.")
    if destination.merged_into_id is not None:
        if destination.merged_into_id != listing.property_id:
            raise ValidationError("ملک تفکیک‌شده به گروه دیگری تعلق دارد.")
        destination.merged_into = None
        destination.merged_at = None
        destination.save(update_fields=["merged_into", "merged_at"])
    return _move_listing(
        listing=listing,
        destination=destination,
        action=ListingGroupingAction.SPLIT,
        reason=reason,
    )


def _attach_locked(*, listing: Listing, destination: Property, reason: str) -> Listing:
    if destination.merged_into_id is not None:
        raise ValidationError("نمی‌توان آگهی را به ملک ادغام‌شده متصل کرد.")
    if not Listing.objects.filter(property=destination).exists():
        raise ValidationError("ملک مقصد باید یک گروه آگهی موجود باشد.")
    return _move_listing(
        listing=listing,
        destination=destination,
        action=ListingGroupingAction.ATTACH,
        reason=reason,
    )


@transaction.atomic
def split_listing(*, listing: Listing, separate_property: Property, reason: str = "") -> Listing:
    listing, separate_property = _locked_listing_and_property(
        listing=listing, destination=separate_property
    )
    return _split_locked(listing=listing, destination=separate_property, reason=reason)


@transaction.atomic
def attach_listing(*, listing: Listing, existing_property: Property, reason: str = "") -> Listing:
    listing, existing_property = _locked_listing_and_property(
        listing=listing, destination=existing_property
    )
    return _attach_locked(listing=listing, destination=existing_property, reason=reason)


@transaction.atomic
def regroup_listing(*, listing: Listing, destination: Property, reason: str = "") -> Listing:
    listing, destination = _locked_listing_and_property(listing=listing, destination=destination)
    if Listing.objects.filter(property=destination).exists():
        return _attach_locked(listing=listing, destination=destination, reason=reason)
    return _split_locked(listing=listing, destination=destination, reason=reason)
