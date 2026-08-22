from typing import Any, cast

from django import forms
from django.contrib import admin, messages
from django.contrib.admin.helpers import ActionForm
from django.core.exceptions import ValidationError
from django.http import HttpRequest
from django.utils.translation import ngettext

from .models import (
    City,
    District,
    Listing,
    ListingGroupingEvent,
    Neighborhood,
    Property,
    RentalTerms,
    Source,
)
from .money import rial_to_toman, toman_to_rial
from .services import merge_properties, publish_listing, regroup_listing

PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")


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
class CityAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("name_fa", "source_code", "source_year", "reviewed")
    search_fields = ("name_fa", "source_code")


@admin.register(District)
class DistrictAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("name_fa", "number", "city", "reviewed")
    list_filter = ("city", "reviewed")
    search_fields = ("name_fa", "source_code")


@admin.register(Neighborhood)
class NeighborhoodAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("name_fa", "district", "reviewed")
    list_filter = ("district__city", "district", "reviewed")
    search_fields = ("name_fa", "source_code")


@admin.register(Source)
class SourceAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
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
class PropertyAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
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
class RentalTermsAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
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
class ListingAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = (
        "id",
        "property",
        "source",
        "state",
        "availability_confirmed_at",
        "available_until",
    )
    list_filter = ("state", "source", "property__city", "property__district")
    search_fields = ("id", "source_reference", "property__neighborhood__name_fa")
    readonly_fields = ("published_at", "availability_confirmed_at", "available_until")
    actions = ("publish_listings",)

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


@admin.register(ListingGroupingEvent)
class ListingGroupingEventAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
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
