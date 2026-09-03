from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import ClassVar, TypeVar

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.base import ModelBase
from django.utils import timezone

from apps.accounts.capabilities import OperatorCapability


class IntakeKind(models.TextChoices):
    GENERAL = "general", "راهنمایی و پرسش"
    ACCOUNT_DELETION = "account_deletion", "درخواست حذف حساب"
    PUBLIC_CONTACT_REMOVAL = "public_contact_removal", "حذف فوری اطلاعات تماس عمومی"


class SupportClassification(models.TextChoices):
    UNCLASSIFIED = "unclassified", "دسته‌بندی‌نشده"
    GUIDANCE = "guidance", "راهنمایی"
    PRIVACY = "privacy", "حریم خصوصی"
    ACCOUNT_DELETION = "account_deletion", "حذف حساب"
    SPAM = "spam", "هرزنامه"


class SupportPriority(models.TextChoices):
    NORMAL = "normal", "عادی"
    URGENT = "urgent", "فوری"


class SupportRequiredCapability(models.TextChoices):
    GENERAL = OperatorCapability.HANDLE_SUPPORT, "General Support handling"
    PRIVACY = OperatorCapability.HANDLE_PRIVACY_REQUESTS, "Privacy Support handling"


class SupportRequestStatus(models.TextChoices):
    OPEN = "open", "باز"
    IN_PROGRESS = "in_progress", "در حال بررسی"
    ESCALATED = "escalated", "ارجاع‌شده"
    RESOLVED = "resolved", "رسیدگی‌شده"


class SupportMessageAuthor(models.TextChoices):
    REQUESTER = "requester", "Requester"
    OPERATOR = "operator", "Operator"


class SupportRequestEventType(models.TextChoices):
    ASSIGNED = "assigned", "واگذار شد"
    CLASSIFIED = "classified", "دسته‌بندی شد"
    ESCALATED = "escalated", "ارجاع شد"
    PRIORITY_CHANGED = "priority_changed", "فوریت تغییر یافت"
    REASSIGNED = "reassigned", "دوباره واگذار شد"
    RELEASED = "released", "آزاد شد"
    NOTE_ADDED = "note_added", "یادداشت افزوده شد"
    EXTERNAL_CONTACT_RECORDED = "external_contact_recorded", "ارتباط بیرونی ثبت شد"
    RESOLVED = "resolved", "رسیدگی نهایی شد"
    REOPENED = "reopened", "دوباره باز شد"
    IDENTITY_VERIFIED = "identity_verified", "هویت تأیید شد"
    PRIVACY_ACTION_RECORDED = "privacy_action_recorded", "اقدام حریم خصوصی ثبت شد"
    PERSONAL_CONTENT_REDACTED = "personal_content_redacted", "محتوای شخصی حذف شد"


class ExternalContactChannel(models.TextChoices):
    EMAIL = "email", "ایمیل"
    PHONE = "phone", "تلفن"
    IN_PERSON = "in_person", "حضوری"
    OTHER = "other", "سایر"


class SupportResolutionCategory(models.TextChoices):
    ANSWERED_EXTERNALLY = "answered_externally", "پاسخ بیرون از TorobRent"
    ACTION_COMPLETED = "action_completed", "اقدام تکمیل شد"
    DUPLICATE = "duplicate", "تکراری"
    SPAM = "spam", "هرزنامه"
    NO_ACTION_REQUIRED = "no_action_required", "بدون اقدام لازم"


class IdentityVerificationMethod(models.TextChoices):
    OUT_OF_BAND = "out_of_band", "تأیید خارج از TorobRent"


class PrivacyActionType(models.TextChoices):
    DEFENSIVE_CONTACT_REMOVAL = (
        "defensive_contact_removal",
        "حذف دفاعی اطلاعات تماس عمومی",
    )
    PERMANENT_ACCOUNT_ACTION = "permanent_account_action", "اقدام دائمی حساب"


AppendOnlyModelT = TypeVar("AppendOnlyModelT", bound=models.Model)


class AppendOnlyQuerySet(models.QuerySet[AppendOnlyModelT]):
    def update(self, **kwargs: object) -> int:
        raise ValidationError("Operational history is append-only.")

    def delete(self) -> tuple[int, dict[str, int]]:
        raise ValidationError("Operational history is append-only.")

    def bulk_update(
        self,
        objs: Iterable[models.Model],
        fields: Iterable[str],
        batch_size: int | None = None,
    ) -> int:
        raise ValidationError("Operational history is append-only.")


class AppendOnlyManager(models.Manager[AppendOnlyModelT]):
    def get_queryset(self) -> AppendOnlyQuerySet[AppendOnlyModelT]:
        return AppendOnlyQuerySet(self.model, using=self._db)


class AppendOnlyModel(models.Model):
    objects: ClassVar[AppendOnlyManager] = AppendOnlyManager()  # type: ignore[type-arg]

    class Meta:
        abstract = True

    def save(
        self,
        *,
        force_insert: bool | tuple[ModelBase, ...] = False,
        force_update: bool = False,
        using: str | None = None,
        update_fields: Iterable[str] | None = None,
    ) -> None:
        if not self._state.adding:
            raise ValidationError("Operational history is append-only.")
        super().save(
            force_insert=force_insert,
            force_update=force_update,
            using=using,
            update_fields=update_fields,
        )

    def delete(
        self,
        using: str | None = None,
        keep_parents: bool = False,
    ) -> tuple[int, dict[str, int]]:
        raise ValidationError("Operational history is append-only.")


class SupportRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submitter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="support_requests",
    )
    name = models.CharField(max_length=120)
    email = models.EmailField(blank=True)
    intake_kind = models.CharField(
        max_length=32,
        choices=IntakeKind,
        db_column="kind",
        editable=False,
    )
    subject = models.CharField(max_length=120, blank=True)
    message = models.TextField(max_length=4000)
    requester_read_at = models.DateTimeField(null=True, blank=True, editable=False)
    public_updated_at = models.DateTimeField(default=timezone.now, db_index=True, editable=False)
    account_linked_at_intake = models.BooleanField(default=False, editable=False)
    classification = models.CharField(
        max_length=24,
        choices=SupportClassification,
        default=SupportClassification.UNCLASSIFIED,
        db_index=True,
    )
    priority = models.CharField(
        max_length=8,
        choices=SupportPriority,
        default=SupportPriority.NORMAL,
        db_index=True,
    )
    priority_locked = models.BooleanField(default=False, editable=False)
    status = models.CharField(
        max_length=16,
        choices=SupportRequestStatus,
        default=SupportRequestStatus.OPEN,
        db_index=True,
    )
    operator_note = models.TextField(blank=True, max_length=1000)
    escalation_destination = models.CharField(max_length=120, blank=True)
    required_capability = models.CharField(
        max_length=40,
        choices=SupportRequiredCapability,
        blank=True,
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_support_requests",
        editable=False,
    )
    assigned_at = models.DateTimeField(null=True, blank=True, editable=False)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="resolved_support_requests",
        editable=False,
    )
    resolved_at = models.DateTimeField(null=True, blank=True, editable=False)
    resolution_category = models.CharField(
        max_length=24,
        choices=SupportResolutionCategory,
        null=True,
        blank=True,
        editable=False,
    )
    resolution_summary = models.TextField(max_length=1000, blank=True, editable=False)
    personal_content_redacted_at = models.DateTimeField(null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "contact_contactmessage"
        ordering = ("-created_at",)
        verbose_name = "Support Request"
        verbose_name_plural = "Support Requests"
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(assignee__isnull=True, assigned_at__isnull=True)
                    | models.Q(assignee__isnull=False, assigned_at__isnull=False)
                ),
                name="support_assignment_fields_together",
            )
        ]
        indexes = [models.Index(fields=("intake_kind",), name="support_intake_kind_idx")]

    def __str__(self) -> str:
        return f"{self.get_intake_kind_display()}: {self.name}"


class SupportMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    support_request = models.ForeignKey(
        SupportRequest,
        on_delete=models.PROTECT,
        related_name="messages",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="support_messages",
    )
    author_kind = models.CharField(max_length=12, choices=SupportMessageAuthor)
    is_initial = models.BooleanField(default=False, editable=False)
    body = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("support_request",),
                condition=models.Q(is_initial=True),
                name="one_initial_message_per_support_request",
            )
        ]

    def __str__(self) -> str:
        return f"{self.support_request_id}: {self.author_kind}"


class SupportRequestEvent(AppendOnlyModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    support_request = models.ForeignKey(
        SupportRequest,
        on_delete=models.PROTECT,
        related_name="events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="support_request_events",
    )
    event_type = models.CharField(max_length=32, choices=SupportRequestEventType)
    prior_state = models.CharField(max_length=16, choices=SupportRequestStatus)
    new_state = models.CharField(max_length=16, choices=SupportRequestStatus)
    classification = models.CharField(
        max_length=24,
        choices=SupportClassification,
        default=SupportClassification.UNCLASSIFIED,
    )
    prior_classification = models.CharField(
        max_length=24,
        choices=SupportClassification,
        null=True,
        blank=True,
    )
    new_classification = models.CharField(
        max_length=24,
        choices=SupportClassification,
        null=True,
        blank=True,
    )
    prior_priority = models.CharField(
        max_length=8,
        choices=SupportPriority,
        null=True,
        blank=True,
    )
    new_priority = models.CharField(
        max_length=8,
        choices=SupportPriority,
        null=True,
        blank=True,
    )
    escalation_destination = models.CharField(max_length=120, blank=True)
    required_capability = models.CharField(
        max_length=40,
        choices=SupportRequiredCapability,
        blank=True,
    )
    prior_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="support_request_events_reassigned_from",
    )
    new_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="support_request_events_reassigned_to",
    )
    reason = models.TextField(blank=True)
    resolution_category = models.CharField(
        max_length=24,
        choices=SupportResolutionCategory,
        null=True,
        blank=True,
    )
    resolution_summary = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"{self.support_request_id}: {self.prior_state} → {self.new_state}"


class SupportRequestNote(AppendOnlyModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    support_request = models.ForeignKey(
        SupportRequest,
        on_delete=models.PROTECT,
        related_name="notes",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="support_request_notes",
    )
    body = models.TextField(max_length=2000)
    corrects_note = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="corrections",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"{self.support_request_id}: {self.actor_id}"


class SupportExternalContact(AppendOnlyModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    support_request = models.ForeignKey(
        SupportRequest,
        on_delete=models.PROTECT,
        related_name="external_contacts",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="support_external_contacts",
    )
    channel = models.CharField(max_length=16, choices=ExternalContactChannel)
    occurred_at = models.DateTimeField()
    outcome = models.CharField(max_length=120)
    summary = models.TextField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("occurred_at", "created_at", "id")

    def __str__(self) -> str:
        return f"{self.support_request_id}: {self.channel}"


class SupportIdentityVerification(AppendOnlyModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    support_request = models.ForeignKey(
        SupportRequest,
        on_delete=models.PROTECT,
        related_name="identity_verifications",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="support_identity_verifications",
    )
    method = models.CharField(max_length=16, choices=IdentityVerificationMethod)
    verified_at = models.DateTimeField()
    summary = models.TextField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("verified_at", "created_at", "id")

    def __str__(self) -> str:
        return f"{self.support_request_id}: {self.method}"


class SupportPrivacyAction(AppendOnlyModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    support_request = models.ForeignKey(
        SupportRequest,
        on_delete=models.PROTECT,
        related_name="privacy_actions",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="support_privacy_actions",
    )
    action = models.CharField(max_length=32, choices=PrivacyActionType)
    completed_at = models.DateTimeField()
    summary = models.TextField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("completed_at", "created_at", "id")

    def __str__(self) -> str:
        return f"{self.support_request_id}: {self.action}"
