"""Shared Catalog Curation authority, claim lifetime, and reviewed facts."""

from datetime import timedelta
from uuid import UUID

from rest_framework.exceptions import APIException, PermissionDenied

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User

CLAIM_LIFETIME = timedelta(minutes=10)


class ReviewConflict(APIException):
    status_code = 409
    default_detail = "شواهد یا مسئول بررسی تغییر کرده است؛ مقایسه را تازه کنید."


def _authorize(actor: User, *, administrative: bool = False) -> None:
    # Re-read permissions rather than trusting a request's cached capability set.
    actor = User.objects.get(pk=actor.pk)
    if administrative:
        if not actor.is_active or not actor.is_superuser:
            raise PermissionDenied("دسترسی ابرکاربر برای تعمیر مدیریتی لازم است.")
    elif not has_capability(actor, OperatorCapability.CURATE_CATALOG):
        raise PermissionDenied("مجوز ساماندهی کاتالوگ لازم است.")


FACT_FIELDS = {
    "city_id": "شهر",
    "district_id": "منطقه",
    "neighborhood_id": "محله",
    "property_type": "نوع ملک",
    "area_sqm": "متراژ",
    "room_count": "تعداد اتاق",
    "construction_year": "سال ساخت",
    "floor": "طبقه",
    "total_floors": "تعداد طبقات",
    "units_per_floor": "واحد در طبقه",
    "parking": "پارکینگ",
    "elevator": "آسانسور",
    "storage": "انباری",
    "balcony": "بالکن",
    "furnished": "مبله",
    "heating": "گرمایش",
    "cooling": "سرمایش",
    "latitude": "عرض جغرافیایی دقیق",
    "longitude": "طول جغرافیایی دقیق",
    "operator_location_notes": "یادداشت مکان",
    "provenance_note": "یادداشت شواهد",
}


def _eligible(actor: User, properties: list[UUID]) -> None:
    from apps.submissions.models import Submission

    from ..models import OutboundPolicy

    if Submission.objects.filter(
        submitter=actor,
        listing__property_id__in=properties,
        listing__source__outbound_policy=OutboundPolicy.DIRECT_CONTACT,
    ).exists():
        raise PermissionDenied("نمی‌توانید درباره آگهی مستقیم خود تصمیم بگیرید.")
