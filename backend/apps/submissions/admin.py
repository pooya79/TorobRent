from typing import Any

from django.contrib import admin
from django.http import HttpRequest
from django.urls import reverse
from django.utils.html import format_html

from .models import Submission, SubmissionImage, SubmissionImageVariantKind
from .services import remove_submission_image


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
