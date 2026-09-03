from datetime import timedelta
from typing import Any, cast

from django import forms
from django.contrib import admin, messages
from django.contrib.admin.helpers import ActionForm
from django.core.exceptions import ValidationError
from django.db.models import Count, Q, QuerySet
from django.http import HttpRequest
from django.utils import timezone
from django.utils.translation import ngettext
from unfold.admin import ModelAdmin

from .models import (
    City,
    District,
    Listing,
    ListingGroupingEvent,
    ListingState,
    Neighborhood,
    ProductEvent,
    Property,
    RentalTerms,
    Source,
)
from .money import rial_to_toman, toman_to_rial
from .services import (
    archive_listing,
    confirm_listing_availability,
    mark_listing_unavailable,
    merge_properties,
    publish_listing,
    regroup_listing,
)

PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")


class AvailabilityStatusFilter(admin.SimpleListFilter):
    title = "وضعیت موجودی"
    parameter_name = "availability_status"

    def lookups(
        self, request: HttpRequest, model_admin: admin.ModelAdmin[Any]
    ) -> tuple[tuple[str, str], ...]:
        return (
            ("expiring_soon", "رو به انقضا"),
            ("expired", "منقضی"),
            ("unavailable", "ناموجود"),
            ("archived", "بایگانی‌شده"),
        )

    def queryset(self, request: HttpRequest, queryset: QuerySet[Listing]) -> QuerySet[Listing]:
        now = timezone.now()
        if self.value() == "expiring_soon":
            return queryset.filter(
                state=ListingState.PUBLISHED,
                available_until__gt=now,
                available_until__lte=now + timedelta(days=7),
            )
        if self.value() == "expired":
            return queryset.filter(
                Q(state=ListingState.EXPIRED)
                | Q(state=ListingState.PUBLISHED, available_until__lte=now)
            )
        if self.value() == "unavailable":
            return queryset.filter(state=ListingState.UNAVAILABLE)
        if self.value() == "archived":
            return queryset.filter(state=ListingState.ARCHIVED)
        return queryset


class EventPeriodFilter(admin.SimpleListFilter):
    title = "بازه زمانی (پیش‌فرض ۷ روز)"
    parameter_name = "period"

    def lookups(
        self, request: HttpRequest, model_admin: admin.ModelAdmin[Any]
    ) -> tuple[tuple[str, str], ...]:
        return (("24h", "۲۴ ساعت"), ("7d", "۷ روز"), ("30d", "۳۰ روز"))

    def queryset(
        self, request: HttpRequest, queryset: QuerySet[ProductEvent]
    ) -> QuerySet[ProductEvent]:
        selected_period = self.value() or "7d"
        duration = {
            "24h": timedelta(hours=24),
            "7d": timedelta(days=7),
            "30d": timedelta(days=30),
        }.get(selected_period)
        if duration is None:
            return queryset
        return queryset.filter(created_at__gte=timezone.now() - duration)


def parse_toman(value: str) -> int:
    normalized = value.translate(PERSIAN_DIGITS).replace(",", "").replace("٬", "").strip()
    if not normalized.isdecimal():
        raise forms.ValidationError("مبلغ را به‌صورت عدد نامنفی وارد کنید.")
    return int(normalized)


class RentalTermsAdminForm(forms.ModelForm):  # type: ignore[type-arg]
    deposit_toman = forms.CharField(label="ودیعه (تومان)")
    monthly_rent_toman = forms.CharField(label="اجاره ماهانه (تومان)")
    is_negotiable = forms.BooleanField(label="قابل مذاکره", required=False)
    is_convertible = forms.BooleanField(label="قابل تبدیل", required=False)

    class Meta:
        model = RentalTerms
        fields: tuple[str, ...] = ()

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        if not self.instance._state.adding:
            self.fields["deposit_toman"].initial = rial_to_toman(self.instance.deposit_rial)
            self.fields["monthly_rent_toman"].initial = rial_to_toman(
                self.instance.monthly_rent_rial
            )
            self.fields["is_negotiable"].initial = self.instance.is_negotiable
            self.fields["is_convertible"].initial = self.instance.is_convertible

    def clean_deposit_toman(self) -> int:
        return parse_toman(self.cleaned_data["deposit_toman"])

    def clean_monthly_rent_toman(self) -> int:
        return parse_toman(self.cleaned_data["monthly_rent_toman"])

    def save(self, commit: bool = True) -> RentalTerms:
        instance = cast(RentalTerms, super().save(commit=False))
        instance.deposit_rial = toman_to_rial(self.cleaned_data["deposit_toman"])
        instance.monthly_rent_rial = toman_to_rial(self.cleaned_data["monthly_rent_toman"])
        instance.is_negotiable = self.cleaned_data["is_negotiable"]
        instance.is_convertible = self.cleaned_data["is_convertible"]
        instance.full_clean()
        if commit:
            instance.save()
        return instance


class PropertyMergeActionForm(ActionForm):
    target_property = forms.ModelChoiceField(
        queryset=Property.objects.filter(merged_into__isnull=True),
        required=False,
        label="ملک مقصد ادغام",
    )


@admin.register(City)
class CityAdmin(ModelAdmin):  # type: ignore[type-arg]
    list_display = ("name_fa", "source_code", "source_year", "reviewed")
    search_fields = ("name_fa", "source_code")


@admin.register(District)
class DistrictAdmin(ModelAdmin):  # type: ignore[type-arg]
    list_display = ("name_fa", "number", "city", "reviewed")
    list_filter = ("city", "reviewed")
    search_fields = ("name_fa", "source_code")


@admin.register(Neighborhood)
class NeighborhoodAdmin(ModelAdmin):  # type: ignore[type-arg]
    list_display = ("name_fa", "district", "reviewed")
    list_filter = ("district__city", "district", "reviewed")
    search_fields = ("name_fa", "source_code")


@admin.register(Source)
class SourceAdmin(ModelAdmin):  # type: ignore[type-arg]
    list_display = (
        "display_name",
        "domain",
        "is_active",
        "outbound_policy",
        "allows_external_media",
        "is_builtin",
    )
    list_filter = ("is_active", "outbound_policy", "allows_external_media", "is_builtin")
    search_fields = ("name", "display_name", "domain")


@admin.register(Property)
class PropertyAdmin(ModelAdmin):  # type: ignore[type-arg]
    list_display = (
        "id",
        "property_type",
        "city",
        "district",
        "neighborhood",
        "area_sqm",
        "merged_into",
    )
    list_filter = ("property_type", "city", "district")
    search_fields = ("id", "neighborhood__name_fa")
    readonly_fields = ("merged_into", "merged_at")
    action_form = PropertyMergeActionForm
    actions = ("merge_into_target",)

    @admin.action(description="ادغام ملک‌های انتخاب‌شده در ملک مقصد")
    def merge_into_target(self, request: HttpRequest, queryset: Any) -> None:
        target_id = request.POST.get("target_property")
        if not target_id:
            self.message_user(request, "ملک مقصد ادغام را انتخاب کنید.", level=messages.ERROR)
            return
        try:
            target = Property.objects.get(pk=target_id, merged_into__isnull=True)
        except Property.DoesNotExist, ValueError:
            self.message_user(request, "ملک مقصد معتبر نیست.", level=messages.ERROR)
            return

        merged = 0
        for duplicate in queryset.exclude(pk=target.pk):
            try:
                merge_properties(target=target, duplicate=duplicate)
            except ValidationError as exc:
                self.message_user(request, f"{duplicate.id}: {exc}", level=messages.ERROR)
            else:
                merged += 1
        if merged:
            self.message_user(
                request,
                ngettext(
                    "یک ملک تکراری ادغام شد.",
                    f"{merged} ملک تکراری ادغام شدند.",
                    merged,
                ),
                level=messages.SUCCESS,
            )


@admin.register(RentalTerms)
class RentalTermsAdmin(ModelAdmin):  # type: ignore[type-arg]
    form = RentalTermsAdminForm
    list_display = ("id", "deposit_toman", "monthly_rent_toman", "currency")
    search_fields = ("id",)

    @admin.display(description="ودیعه (تومان)")
    def deposit_toman(self, terms: RentalTerms) -> int:
        return rial_to_toman(terms.deposit_rial)

    @admin.display(description="اجاره ماهانه (تومان)")
    def monthly_rent_toman(self, terms: RentalTerms) -> int:
        return rial_to_toman(terms.monthly_rent_rial)


@admin.register(Listing)
class ListingAdmin(ModelAdmin):  # type: ignore[type-arg]
    list_display = (
        "id",
        "property",
        "source",
        "state",
        "availability_confirmed_at",
        "available_until",
    )
    list_filter = (
        AvailabilityStatusFilter,
        "state",
        "source",
        "property__city",
        "property__district",
    )
    search_fields = ("id", "source_reference", "property__neighborhood__name_fa")
    readonly_fields = ("published_at", "availability_confirmed_at", "available_until")
    actions = (
        "publish_listings",
        "confirm_availability",
        "mark_unavailable",
        "archive",
    )

    def save_model(
        self,
        request: HttpRequest,
        obj: Listing,
        form: forms.ModelForm[Any],
        change: bool,
    ) -> None:
        if not change or "property" not in form.changed_data:
            super().save_model(request, obj, form, change)
            return

        original_property_id = Listing.objects.only("property_id").get(pk=obj.pk).property_id
        destination = obj.property
        obj.property_id = original_property_id
        super().save_model(request, obj, form, change)
        regroup_listing(listing=obj, destination=destination)
        obj.property = destination

    @admin.action(description="اعتبارسنجی و انتشار آگهی‌های انتخاب‌شده")
    def publish_listings(self, request: HttpRequest, queryset: Any) -> None:
        published = 0
        for listing in queryset.select_related(
            "property__city", "property__district", "property__neighborhood", "source", "terms"
        ):
            try:
                publish_listing(listing)
            except ValidationError as exc:
                self.message_user(request, f"{listing.id}: {exc}", level=messages.ERROR)
            else:
                published += 1
        if published:
            self.message_user(
                request,
                ngettext("یک آگهی منتشر شد.", f"{published} آگهی منتشر شدند.", published),
                level=messages.SUCCESS,
            )

    @admin.action(description="تأیید موجودی آگهی‌های انتخاب‌شده")
    def confirm_availability(self, request: HttpRequest, queryset: Any) -> None:
        self._apply_availability_action(
            request=request,
            queryset=queryset,
            action=confirm_listing_availability,
            success_message="موجودی {count} آگهی تأیید شد.",
        )

    @admin.action(description="ناموجود کردن آگهی‌های انتخاب‌شده")
    def mark_unavailable(self, request: HttpRequest, queryset: Any) -> None:
        self._apply_availability_action(
            request=request,
            queryset=queryset,
            action=mark_listing_unavailable,
            success_message="{count} آگهی ناموجود شد.",
        )

    @admin.action(description="بایگانی آگهی‌های انتخاب‌شده")
    def archive(self, request: HttpRequest, queryset: Any) -> None:
        self._apply_availability_action(
            request=request,
            queryset=queryset,
            action=archive_listing,
            success_message="{count} آگهی بایگانی شد.",
        )

    def _apply_availability_action(
        self,
        *,
        request: HttpRequest,
        queryset: QuerySet[Listing],
        action: Any,
        success_message: str,
    ) -> None:
        changed = 0
        for listing in queryset:
            try:
                action(listing)
            except ValidationError as exc:
                self.message_user(request, f"{listing.id}: {exc}", level=messages.ERROR)
            else:
                changed += 1
        if changed:
            self.message_user(
                request,
                success_message.format(count=changed),
                level=messages.SUCCESS,
            )


@admin.register(ListingGroupingEvent)
class ListingGroupingEventAdmin(ModelAdmin):  # type: ignore[type-arg]
    list_display = (
        "created_at",
        "action",
        "listing",
        "from_property",
        "to_property",
    )
    list_filter = ("action", "created_at")
    search_fields = ("listing__id", "from_property__id", "to_property__id", "reason")
    readonly_fields = (
        "id",
        "created_at",
        "action",
        "listing",
        "from_property",
        "to_property",
        "reason",
    )

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False


@admin.register(ProductEvent)
class ProductEventAdmin(ModelAdmin):  # type: ignore[type-arg]
    change_list_template = "admin/catalog/productevent/change_list.html"
    list_display = ("created_at", "event_type", "property", "listing", "source")
    list_filter = (EventPeriodFilter, "event_type", "property", "listing", "source")
    date_hierarchy = "created_at"
    readonly_fields = ("id", "created_at", "event_type", "property", "listing", "source")

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

    def changelist_view(
        self,
        request: HttpRequest,
        extra_context: dict[str, Any] | None = None,
    ) -> Any:
        response = super().changelist_view(request, extra_context=extra_context)
        if not hasattr(response, "context_data"):
            return response
        queryset = response.context_data["cl"].queryset
        response.context_data.update(
            event_total=queryset.count(),
            event_type_counts=list(
                queryset.values("event_type").annotate(count=Count("id")).order_by("event_type")
            ),
            property_counts=list(
                queryset.values("property_id").annotate(count=Count("id")).order_by("property_id")
            ),
            listing_counts=list(
                queryset
                .exclude(listing_id=None)
                .values("listing_id")
                .annotate(count=Count("id"))
                .order_by("listing_id")
            ),
            source_counts=list(
                queryset
                .exclude(source_id=None)
                .values("source_id")
                .annotate(count=Count("id"))
                .order_by("source_id")
            ),
        )
        return response
