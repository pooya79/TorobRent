from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


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


class SupportRequestStatus(models.TextChoices):
    OPEN = "open", "باز"
    IN_PROGRESS = "in_progress", "در حال بررسی"
    RESOLVED = "resolved", "رسیدگی‌شده"


class SupportRequestEventType(models.TextChoices):
    ASSIGNED = "assigned", "واگذار شد"
    RELEASED = "released", "آزاد شد"


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
    email = models.EmailField()
    intake_kind = models.CharField(max_length=32, choices=IntakeKind, db_column="kind")
    message = models.TextField(max_length=4000)
    classification = models.CharField(
        max_length=24,
        choices=SupportClassification,
        default=SupportClassification.UNCLASSIFIED,
        db_index=True,
    )
    status = models.CharField(
        max_length=16,
        choices=SupportRequestStatus,
        default=SupportRequestStatus.OPEN,
        db_index=True,
    )
    operator_note = models.TextField(blank=True, max_length=1000)
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


class SupportRequestEvent(models.Model):
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
    event_type = models.CharField(max_length=16, choices=SupportRequestEventType)
    prior_state = models.CharField(max_length=16, choices=SupportRequestStatus)
    new_state = models.CharField(max_length=16, choices=SupportRequestStatus)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"{self.support_request_id}: {self.prior_state} → {self.new_state}"
