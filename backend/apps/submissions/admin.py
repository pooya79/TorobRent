from typing import Any, cast

from django import forms
from django.contrib import admin
from django.http import HttpRequest
from django.urls import reverse
from django.utils.html import format_html

from apps.accounts.models import User

from .models import (
    Submission,
    SubmissionEvent,
    SubmissionEventType,
    SubmissionImage,
    SubmissionImageVariantKind,
)
from .services import append_submission_decision_correction, remove_submission_image


class SubmissionDecisionCorrectionAdminForm(forms.ModelForm):  # type: ignore[type-arg]
    correction = forms.JSONField(label="رکورد اصلاحی")

    class Meta:
        model = SubmissionEvent
        fields = ("corrects", "reason", "correction")

    def clean_corrects(self) -> SubmissionEvent:
        original = cast(SubmissionEvent, self.cleaned_data["corrects"])
        if (
            original is None
            or original.event_type != SubmissionEventType.TRANSITION
            or original.review_claim_id is None
        ):
            raise forms.ValidationError("فقط یک تصمیم اصلی قابل اصلاح است.")
        return original


class SubmissionImageInline(admin.TabularInline):  # type: ignore[type-arg]
    model = SubmissionImage
    fields = ("preview", "status", "failure_reason", "position", "is_primary", "updated_at")
    readonly_fields = fields
    extra = 0
    can_delete = False

    @admin.display(description="پیش‌نمایش")
    def preview(self, image: SubmissionImage) -> str:
        variant = image.variants.filter(kind=SubmissionImageVariantKind.MEDIUM).first()
        if variant is None:
            return "—"
        url = reverse(
            "submissions:image-content",
            kwargs={
                "submission_id": image.submission_id,
                "image_id": image.id,
                "kind": variant.kind,
            },
        )
        return format_html('<a href="{}" target="_blank">مشاهده تصویر</a>', url)


@admin.register(Submission)
class SubmissionAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "submitter", "role", "state", "current_step", "media_complete")
    list_filter = ("role", "state", "current_step", "media_complete")
    search_fields = ("id", "submitter__email", "address")
    inlines = (SubmissionImageInline,)


@admin.register(SubmissionEvent)
class SubmissionEventAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    form = SubmissionDecisionCorrectionAdminForm
    list_display = (
        "id",
        "submission",
        "event_type",
        "actor",
        "revision",
        "prior_state",
        "new_state",
        "created_at",
    )
    list_filter = ("event_type", "prior_state", "new_state")
    search_fields = ("id", "submission__id", "actor__email", "reason")

    def get_readonly_fields(
        self, request: HttpRequest, obj: SubmissionEvent | None = None
    ) -> tuple[str, ...]:
        if obj is None:
            return ()
        return tuple(field.name for field in self.model._meta.fields)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return bool(request.user.is_active and request.user.is_superuser)

    def has_delete_permission(
        self, request: HttpRequest, obj: SubmissionEvent | None = None
    ) -> bool:
        return False

    def save_model(
        self,
        request: HttpRequest,
        obj: SubmissionEvent,
        form: forms.ModelForm[SubmissionEvent],
        change: bool,
    ) -> None:
        if change:
            return
        event = append_submission_decision_correction(
            original_event=form.cleaned_data["corrects"],
            actor=cast(User, request.user),
            reason=form.cleaned_data["reason"],
            correction=form.cleaned_data["correction"],
        )
        obj.__dict__.update(event.__dict__)


@admin.register(SubmissionImage)
class SubmissionImageAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "submission", "status", "position", "is_primary", "updated_at")
    list_filter = ("status", "is_primary")
    search_fields = ("id", "submission__id", "submission__submitter__email")
    readonly_fields = (
        "id",
        "submission",
        "source",
        "status",
        "failure_reason",
        "position",
        "is_primary",
        "created_at",
        "updated_at",
        "processed_at",
    )

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def delete_model(self, request: HttpRequest, obj: SubmissionImage) -> None:
        remove_submission_image(submission=obj.submission, image_id=obj.id)

    def delete_queryset(self, request: HttpRequest, queryset: Any) -> None:
        for image in queryset.select_related("submission"):
            remove_submission_image(submission=image.submission, image_id=image.id)
