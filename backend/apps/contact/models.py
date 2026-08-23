from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class ContactMessageKind(models.TextChoices):
    GENERAL = "general", "راهنمایی و پرسش"
    ACCOUNT_DELETION = "account_deletion", "درخواست حذف حساب"
    PUBLIC_CONTACT_REMOVAL = "public_contact_removal", "حذف فوری اطلاعات تماس عمومی"


class ContactMessageClassification(models.TextChoices):
    UNCLASSIFIED = "unclassified", "دسته‌بندی‌نشده"
    GUIDANCE = "guidance", "راهنمایی"
    PRIVACY = "privacy", "حریم خصوصی"
    ACCOUNT_DELETION = "account_deletion", "حذف حساب"
    SPAM = "spam", "هرزنامه"


class ContactMessageStatus(models.TextChoices):
    OPEN = "open", "باز"
    IN_PROGRESS = "in_progress", "در حال بررسی"
    RESOLVED = "resolved", "رسیدگی‌شده"


class ContactMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    submitter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="contact_messages",
    )
    name = models.CharField(max_length=120)
    email = models.EmailField()
    kind = models.CharField(max_length=32, choices=ContactMessageKind)
    message = models.TextField(max_length=4000)
    classification = models.CharField(
        max_length=24,
        choices=ContactMessageClassification,
        default=ContactMessageClassification.UNCLASSIFIED,
    )
    status = models.CharField(
        max_length=16,
        choices=ContactMessageStatus,
        default=ContactMessageStatus.OPEN,
    )
    operator_note = models.TextField(blank=True, max_length=1000)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="resolved_contact_messages",
        editable=False,
    )
    resolved_at = models.DateTimeField(null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.get_kind_display()}: {self.name}"
